import Foundation

public protocol StateStore {
  associatedtype State

  func getState() -> State
  @discardableResult
  func subscribe(_ listener: @escaping () -> Void) -> StoreSubscription
}

public protocol StoreSubscription {
  func unsubscribe()
}

public protocol StoreTarget {
  func register(_ path: String, descriptor: NodeDescriptor) throws
  func unregister(_ path: String, recursive: Bool) throws
}

extension SlopServer: StoreTarget {}

public struct ExposeStoreOptions<State> {
  public var equals: ((State, State) -> Bool)?
  public var debounceMilliseconds: Int

  public init(equals: ((State, State) -> Bool)? = nil, debounceMilliseconds: Int = 0) {
    self.equals = equals
    self.debounceMilliseconds = debounceMilliseconds
  }
}

public final class StoreExposure {
  private let dispose: () -> Void
  private let lock = NSLock()
  private var disposed = false

  init(dispose: @escaping () -> Void) {
    self.dispose = dispose
  }

  public func unsubscribe() {
    lock.lock()
    guard !disposed else {
      lock.unlock()
      return
    }
    disposed = true
    lock.unlock()
    dispose()
  }
}

public enum StorePath<State> {
  case fixed(String)
  case dynamic((State) -> String)

  func resolve(_ state: State) -> String {
    switch self {
    case .fixed(let path):
      return path
    case .dynamic(let resolve):
      return resolve(state)
    }
  }
}

@discardableResult
public func exposeStore<S: StateStore, Target: StoreTarget>(
  target: Target,
  path: StorePath<S.State>,
  store: S,
  project: @escaping (S.State) -> NodeDescriptor,
  options: ExposeStoreOptions<S.State> = ExposeStoreOptions()
) throws -> StoreExposure {
  let stateLock = NSRecursiveLock()
  var currentPath: String?
  var previousState: S.State?
  var hasPreviousState = false
  var disposed = false
  var debounceTask: Task<Void, Never>?

  func update() throws {
    stateLock.lock()
    defer { stateLock.unlock() }
    guard !disposed else { return }
    let state = store.getState()
    if hasPreviousState, let previous = previousState, options.equals?(previous, state) == true {
      return
    }
    let nextPath = path.resolve(state)
    if let currentPath, currentPath != nextPath {
      try target.register(nextPath, descriptor: project(state))
      do {
        try target.unregister(currentPath, recursive: true)
      } catch {
        try? target.unregister(nextPath, recursive: true)
        throw error
      }
    } else {
      try target.register(nextPath, descriptor: project(state))
    }
    currentPath = nextPath
    previousState = state
    hasPreviousState = true
  }

  func scheduleUpdate() {
    stateLock.lock()
    defer { stateLock.unlock() }
    guard !disposed else { return }
    let delay = options.debounceMilliseconds
    guard delay > 0 else {
      try? update()
      return
    }
    debounceTask?.cancel()
    let (nanoseconds, overflow) = UInt64(delay).multipliedReportingOverflow(by: 1_000_000)
    debounceTask = Task {
      try? await Task.sleep(nanoseconds: overflow ? UInt64.max : nanoseconds)
      guard !Task.isCancelled else { return }
      try? update()
    }
  }

  let subscription = store.subscribe(scheduleUpdate)
  do {
    try update()
  } catch {
    stateLock.lock()
    disposed = true
    let pendingTask = debounceTask
    debounceTask = nil
    stateLock.unlock()
    pendingTask?.cancel()
    subscription.unsubscribe()
    throw error
  }

  return StoreExposure {
    stateLock.lock()
    guard !disposed else {
      stateLock.unlock()
      return
    }
    disposed = true
    let pendingTask = debounceTask
    debounceTask = nil
    let registeredPath = currentPath
    currentPath = nil
    stateLock.unlock()

    pendingTask?.cancel()
    subscription.unsubscribe()
    if let registeredPath {
      try? target.unregister(registeredPath, recursive: true)
    }
  }
}
