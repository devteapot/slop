import Foundation

public typealias SlopMessage = [String: JSONValue]

public protocol SlopConnection: AnyObject {
  func send(_ message: SlopMessage)
  func onMessage(_ handler: @escaping (SlopMessage) -> Void)
  func onClose(_ handler: @escaping () -> Void)
  func close()
}

public protocol ClientTransport {
  func connect() async throws -> SlopConnection
}

public final class InMemoryConnection: SlopConnection, @unchecked Sendable {
  private let lock = NSLock()
  private var messageHandlers: [(SlopMessage) -> Void] = []
  private var closeHandlers: [() -> Void] = []
  private var pendingMessages: [SlopMessage] = []
  private var messageHandlerWaiters: [CheckedContinuation<Void, Never>] = []
  private var didClose = false
  private let sendHandler: (SlopMessage) -> Void

  public init(sendHandler: @escaping (SlopMessage) -> Void = { _ in }) {
    self.sendHandler = sendHandler
  }

  public func send(_ message: SlopMessage) {
    sendHandler(message)
  }

  public func receive(_ message: SlopMessage) {
    lock.lock()
    let handlers = messageHandlers
    if handlers.isEmpty {
      pendingMessages.append(message)
      lock.unlock()
      return
    }
    lock.unlock()

    for handler in handlers {
      handler(message)
    }
  }

  public func onMessage(_ handler: @escaping (SlopMessage) -> Void) {
    lock.lock()
    messageHandlers.append(handler)
    let pending = pendingMessages
    pendingMessages.removeAll()
    let waiters = messageHandlerWaiters
    messageHandlerWaiters.removeAll()
    lock.unlock()

    for message in pending {
      handler(message)
    }
    for waiter in waiters {
      waiter.resume()
    }
  }

  public func onClose(_ handler: @escaping () -> Void) {
    lock.lock()
    let alreadyClosed = didClose
    if !alreadyClosed {
      closeHandlers.append(handler)
    }
    lock.unlock()
    if alreadyClosed {
      handler()
    }
  }

  public func waitForMessageHandler() async {
    await withCheckedContinuation { continuation in
      lock.lock()
      if !messageHandlers.isEmpty {
        lock.unlock()
        continuation.resume()
      } else {
        messageHandlerWaiters.append(continuation)
        lock.unlock()
      }
    }
  }

  public func close() {
    lock.lock()
    guard !didClose else {
      lock.unlock()
      return
    }
    didClose = true
    let handlers = closeHandlers
    lock.unlock()

    for handler in handlers {
      handler()
    }
  }
}

public final class InMemoryTransport: ClientTransport {
  public let connection: InMemoryConnection

  public init(connection: InMemoryConnection = InMemoryConnection()) {
    self.connection = connection
  }

  public func connect() async throws -> SlopConnection {
    connection
  }
}

public final class URLSessionWebSocketTransport: ClientTransport {
  private let request: URLRequest
  private let session: URLSession

  public convenience init(url: URL, session: URLSession = .shared) {
    self.init(request: URLRequest(url: url), session: session)
  }

  public init(request: URLRequest, session: URLSession = .shared) {
    self.request = request
    self.session = session
  }

  public func connect() async throws -> SlopConnection {
    let task = session.webSocketTask(with: request)
    let connection = URLSessionWebSocketConnection(task: task)
    task.resume()
    connection.startReceiving()
    return connection
  }
}

public final class URLSessionWebSocketConnection: SlopConnection {
  private let task: URLSessionWebSocketTask
  private let lock = NSLock()
  private var messageHandlers: [(SlopMessage) -> Void] = []
  private var closeHandlers: [() -> Void] = []
  private var pendingMessages: [SlopMessage] = []
  private var didClose = false
  private var sendTail: Task<Void, Never>?

  init(task: URLSessionWebSocketTask) {
    self.task = task
  }

  public func send(_ message: SlopMessage) {
    lock.lock()
    let previous = sendTail
    let next = Task { [weak self] in
      await previous?.value
      guard let self else { return }
      do {
        let data = try JSONEncoder().encode(JSONValue.object(message))
        let text = String(decoding: data, as: UTF8.self)
        try await self.task.send(.string(text))
      } catch {
        self.fireClose()
      }
    }
    sendTail = next
    lock.unlock()
  }

  public func onMessage(_ handler: @escaping (SlopMessage) -> Void) {
    lock.lock()
    messageHandlers.append(handler)
    let pending = pendingMessages
    pendingMessages.removeAll()
    lock.unlock()

    for message in pending {
      handler(message)
    }
  }

  public func onClose(_ handler: @escaping () -> Void) {
    lock.lock()
    let alreadyClosed = didClose
    if !alreadyClosed {
      closeHandlers.append(handler)
    }
    lock.unlock()
    if alreadyClosed {
      handler()
    }
  }

  public func close() {
    task.cancel(with: .normalClosure, reason: nil)
    fireClose()
  }

  func startReceiving() {
    Task {
      await receiveLoop()
    }
  }

  private func receiveLoop() async {
    while !isClosed {
      do {
        let message = try await task.receive()
        guard let slopMessage = try decode(message) else {
          continue
        }
        fireMessage(slopMessage)
      } catch {
        fireClose()
        return
      }
    }
  }

  private var isClosed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return didClose
  }

  private func decode(_ message: URLSessionWebSocketTask.Message) throws -> SlopMessage? {
    let data: Data
    switch message {
    case .string(let text):
      guard let stringData = text.data(using: .utf8) else { return nil }
      data = stringData
    case .data(let rawData):
      data = rawData
    @unknown default:
      return nil
    }

    guard case .object(let object) = try JSONDecoder().decode(JSONValue.self, from: data) else {
      return nil
    }
    return object
  }

  private func fireMessage(_ message: SlopMessage) {
    lock.lock()
    let handlers = messageHandlers
    if handlers.isEmpty {
      pendingMessages.append(message)
      lock.unlock()
      return
    }
    lock.unlock()

    for handler in handlers {
      handler(message)
    }
  }

  private func fireClose() {
    lock.lock()
    guard !didClose else {
      lock.unlock()
      return
    }
    didClose = true
    let handlers = closeHandlers
    lock.unlock()

    for handler in handlers {
      handler()
    }
  }
}

func messageString(_ message: SlopMessage, _ key: String) -> String? {
  message[key]?.stringValue
}

func messageInt(_ message: SlopMessage, _ key: String) -> Int? {
  message[key]?.intValue
}

func messageUInt64(_ message: SlopMessage, _ key: String) -> UInt64? {
  guard let int = message[key]?.intValue, int >= 0 else { return nil }
  return UInt64(int)
}

func messageObject(_ message: SlopMessage, _ key: String) -> [String: JSONValue]? {
  message[key]?.objectValue
}

func messageWindow(_ message: SlopMessage, _ key: String) -> WindowRange? {
  guard let array = message[key]?.arrayValue, array.count == 2, let offset = array[0].intValue, let count = array[1].intValue else {
    return nil
  }
  return WindowRange(offset, count)
}

func messageFilter(_ message: SlopMessage) -> SubscriptionFilter? {
  guard let object = messageObject(message, "filter") else { return nil }
  let types = object["types"]?.arrayValue?.compactMap(\.stringValue)
  let minSalience = object["min_salience"]?.doubleValue
  return SubscriptionFilter(types: types, minSalience: minSalience)
}

func snapshotMessage(id: String, version: UInt64, seq: UInt64? = nil, tree: SlopNode) -> SlopMessage {
  var message: SlopMessage = [
    "type": "snapshot",
    "id": .string(id),
    "version": .number(Double(version)),
    "tree": wireJSON(tree),
  ]
  if let seq {
    message["seq"] = .number(Double(seq))
  }
  return message
}

func patchMessage(subscription: String, version: UInt64, seq: UInt64, ops: [PatchOp]) -> SlopMessage {
  [
    "type": "patch",
    "subscription": .string(subscription),
    "version": .number(Double(version)),
    "seq": .number(Double(seq)),
    "ops": wireJSON(ops),
  ]
}

func errorMessage(id: String?, code: String, message: String) -> SlopMessage {
  var result: SlopMessage = [
    "type": "error",
    "error": .object([
      "code": .string(code),
      "message": .string(message),
    ]),
  ]
  if let id {
    result["id"] = .string(id)
  }
  return result
}

func resultMessage(id: String, status: String, data: JSONValue? = nil, code: String? = nil, message: String? = nil) -> SlopMessage {
  var result: SlopMessage = [
    "type": "result",
    "id": .string(id),
    "status": .string(status),
  ]
  if let data {
    result["data"] = data
  }
  if let code, let message {
    result["error"] = .object(["code": .string(code), "message": .string(message)])
  }
  return result
}
