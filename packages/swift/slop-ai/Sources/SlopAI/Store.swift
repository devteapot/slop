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
  private var disposed = false

  init(dispose: @escaping () -> Void) {
    self.dispose = dispose
  }

  public func unsubscribe() {
    guard !disposed else { return }
    disposed = true
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
  var currentPath: String?
  var previousState: S.State?
  var hasPreviousState = false
  var disposed = false
  var debounceTask: Task<Void, Never>?

  func update() {
    guard !disposed else { return }
    let state = store.getState()
    if hasPreviousState, let previous = previousState, options.equals?(previous, state) == true {
      return
    }
    let nextPath = path.resolve(state)
    if let currentPath, currentPath != nextPath {
      try? target.unregister(currentPath, recursive: true)
    }
    try? target.register(nextPath, descriptor: project(state))
    currentPath = nextPath
    previousState = state
    hasPreviousState = true
  }

  func scheduleUpdate() {
    guard !disposed else { return }
    let delay = options.debounceMilliseconds
    guard delay > 0 else {
      update()
      return
    }
    debounceTask?.cancel()
    debounceTask = Task {
      try? await Task.sleep(nanoseconds: UInt64(delay) * 1_000_000)
      guard !Task.isCancelled else { return }
      update()
    }
  }

  update()
  let subscription = store.subscribe(scheduleUpdate)

  return StoreExposure {
    disposed = true
    debounceTask?.cancel()
    subscription.unsubscribe()
    if let currentPath {
      try? target.unregister(currentPath, recursive: true)
    }
  }
}
