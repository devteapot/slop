import Foundation

public final class SlopConsumer {
  private var connection: SlopConnection?
  private var mirrors: [String: StateMirror] = [:]
  private var subscriptions: [String: (path: String, depth: Int, options: OutputRequest)] = [:]
  private var pending: [String: (Result<JSONValue, Error>) -> Void] = [:]
  private let transport: ClientTransport
  private var subscriptionCounter = 0
  private var requestCounter = 0
  private var errorCallbacks: [([String: JSONValue], String?) -> Void] = []
  private var eventCallbacks: [(String, JSONValue?) -> Void] = []
  private var patchCallbacks: [(String, [PatchOp], UInt64) -> Void] = []
  private var gapCallbacks: [(String, UInt64, UInt64) -> Void] = []
  private var disconnectCallbacks: [() -> Void] = []

  public init(transport: ClientTransport) {
    self.transport = transport
  }

  public convenience init?(descriptor: ProviderDescriptor) {
    guard let transport = Discovery.defaultTransportFactory(descriptor) else {
      return nil
    }
    self.init(transport: transport)
  }

  public static func connect(to descriptor: ProviderDescriptor) async throws -> SlopConsumer? {
    guard let consumer = SlopConsumer(descriptor: descriptor) else {
      return nil
    }
    _ = try await consumer.connect()
    return consumer
  }

  public func connect() async throws -> SlopMessage {
    let connection = try await transport.connect()
    self.connection = connection
    return try await withCheckedThrowingContinuation { continuation in
      var didResume = false
      connection.onMessage { [weak self] message in
        guard let self else { return }
        if !didResume, messageString(message, "type") == "hello" {
          didResume = true
          continuation.resume(returning: message)
          return
        }
        self.handleMessage(message)
      }
      connection.onClose { [weak self] in
        if !didResume {
          didResume = true
          continuation.resume(throwing: SlopError.internalError("SLOP connection closed before hello"))
        }
        self?.connection = nil
        self?.fireDisconnect()
      }
    }
  }

  /// Manually inject a message. Useful for tests and custom embedding layers.
  public func receive(_ message: SlopMessage) {
    handleMessage(message)
  }

  public func subscribe(path: String = "/", depth: Int = 1, options: OutputRequest = OutputRequest()) async throws -> (id: String, snapshot: SlopNode) {
    subscriptionCounter += 1
    let id = "sub-\(subscriptionCounter)"
    subscriptions[id] = (path, depth, options)
    let snapshotValue = try await sendRequest(id: id) { [weak self] in
      self?.sendSubscribe(id: id)
    }
    let snapshot = try decodeJSONValue(snapshotValue, as: SlopNode.self)
    return (id, snapshot)
  }

  public func unsubscribe(_ id: String) {
    mirrors.removeValue(forKey: id)
    subscriptions.removeValue(forKey: id)
    connection?.send(["type": "unsubscribe", "id": .string(id)])
  }

  public func query(path: String = "/", depth: Int = 1, options: OutputRequest = OutputRequest()) async throws -> SlopNode {
    requestCounter += 1
    let id = "q-\(requestCounter)"
    let value = try await sendRequest(id: id) { [weak self] in
      var message: SlopMessage = [
        "type": "query",
        "id": .string(id),
        "path": .string(path),
        "depth": .number(Double(depth)),
      ]
      if let maxNodes = options.maxNodes {
        message["max_nodes"] = .number(Double(maxNodes))
      }
      if let filter = options.filter {
        var filterObject: [String: JSONValue] = [:]
        if let types = filter.types {
          filterObject["types"] = .array(types.map(JSONValue.string))
        }
        if let minSalience = filter.minSalience {
          filterObject["min_salience"] = .number(minSalience)
        }
        message["filter"] = .object(filterObject)
      }
      if let window = options.window {
        message["window"] = .array([.number(Double(window.offset)), .number(Double(window.count))])
      }
      self?.connection?.send(message)
    }
    return try decodeJSONValue(value, as: SlopNode.self)
  }

  public func invoke(path: String, action: String, params: [String: JSONValue] = [:]) async throws -> SlopMessage {
    requestCounter += 1
    let id = "inv-\(requestCounter)"
    let value = try await sendRequest(id: id) { [weak self] in
      self?.connection?.send([
        "type": "invoke",
        "id": .string(id),
        "path": .string(path),
        "action": .string(action),
        "params": .object(params),
      ])
    }
    return value.objectValue ?? [:]
  }

  public func getTree(subscriptionID: String) -> SlopNode? {
    mirrors[subscriptionID]?.getTree()
  }

  @discardableResult
  public func onError(_ callback: @escaping ([String: JSONValue], String?) -> Void) -> () -> Void {
    errorCallbacks.append(callback)
    let index = errorCallbacks.count - 1
    return { [weak self] in
      self?.removeCallback(at: index, from: \.errorCallbacks)
    }
  }

  @discardableResult
  public func onEvent(_ callback: @escaping (String, JSONValue?) -> Void) -> () -> Void {
    eventCallbacks.append(callback)
    let index = eventCallbacks.count - 1
    return { [weak self] in
      self?.removeCallback(at: index, from: \.eventCallbacks)
    }
  }

  @discardableResult
  public func onPatch(_ callback: @escaping (String, [PatchOp], UInt64) -> Void) -> () -> Void {
    patchCallbacks.append(callback)
    let index = patchCallbacks.count - 1
    return { [weak self] in
      self?.removeCallback(at: index, from: \.patchCallbacks)
    }
  }

  @discardableResult
  public func onGap(_ callback: @escaping (String, UInt64, UInt64) -> Void) -> () -> Void {
    gapCallbacks.append(callback)
    let index = gapCallbacks.count - 1
    return { [weak self] in
      self?.removeCallback(at: index, from: \.gapCallbacks)
    }
  }

  @discardableResult
  public func onDisconnect(_ callback: @escaping () -> Void) -> () -> Void {
    disconnectCallbacks.append(callback)
    let index = disconnectCallbacks.count - 1
    return { [weak self] in
      self?.removeCallback(at: index, from: \.disconnectCallbacks)
    }
  }

  public func disconnect() {
    connection?.close()
    connection = nil
  }

  private func sendRequest(id: String, send: () -> Void) async throws -> JSONValue {
    try await withCheckedThrowingContinuation { continuation in
      pending[id] = { result in
        continuation.resume(with: result)
      }
      send()
    }
  }

  private func sendSubscribe(id: String) {
    guard let subscription = subscriptions[id] else { return }
    var message: SlopMessage = [
      "type": "subscribe",
      "id": .string(id),
      "path": .string(subscription.path),
      "depth": .number(Double(subscription.depth)),
    ]
    if let maxNodes = subscription.options.maxNodes {
      message["max_nodes"] = .number(Double(maxNodes))
    }
    if let filter = subscription.options.filter {
      var filterObject: [String: JSONValue] = [:]
      if let types = filter.types {
        filterObject["types"] = .array(types.map(JSONValue.string))
      }
      if let minSalience = filter.minSalience {
        filterObject["min_salience"] = .number(minSalience)
      }
      message["filter"] = .object(filterObject)
    }
    connection?.send(message)
  }

  private func removeCallback<T>(at index: Int, from keyPath: ReferenceWritableKeyPath<SlopConsumer, [T]>) {
    var callbacks = self[keyPath: keyPath]
    guard callbacks.indices.contains(index) else { return }
    callbacks.remove(at: index)
    self[keyPath: keyPath] = callbacks
  }

  private func fireDisconnect() {
    let callbacks = disconnectCallbacks
    for callback in callbacks {
      callback()
    }
  }

  private func handleMessage(_ message: SlopMessage) {
    switch messageString(message, "type") {
    case "snapshot":
      handleSnapshot(message)
    case "patch":
      handlePatch(message)
    case "result":
      handleResult(message)
    case "error":
      let error = messageObject(message, "error") ?? [:]
      let id = messageString(message, "id")
      if let id, let callback = pending.removeValue(forKey: id) {
        callback(.failure(SlopError.internalError(error["message"]?.stringValue ?? "SLOP error")))
      }
      for callback in errorCallbacks {
        callback(error, id)
      }
    case "event":
      if let name = messageString(message, "name") {
        for callback in eventCallbacks {
          callback(name, message["data"])
        }
      }
    case "batch":
      for inner in message["messages"]?.arrayValue ?? [] {
        if let object = inner.objectValue {
          handleMessage(object)
        }
      }
    default:
      break
    }
  }

  private func handleSnapshot(_ message: SlopMessage) {
    guard
      let id = messageString(message, "id"),
      let version = messageUInt64(message, "version"),
      let treeValue = message["tree"],
      let tree = try? decodeJSONValue(treeValue, as: SlopNode.self)
    else {
      return
    }

    let existed = mirrors[id] != nil
    mirrors[id] = StateMirror(snapshot: SnapshotMessage(id: id, version: version, seq: messageUInt64(message, "seq"), tree: tree))
    if let callback = pending.removeValue(forKey: id) {
      callback(.success(treeValue))
    } else if existed {
      for callback in patchCallbacks {
        callback(id, [], version)
      }
    }
  }

  private func handlePatch(_ message: SlopMessage) {
    guard
      let subscription = messageString(message, "subscription"),
      let version = messageUInt64(message, "version"),
      let opsValue = message["ops"],
      let ops = try? decodeJSONValue(opsValue, as: [PatchOp].self),
      let mirror = mirrors[subscription]
    else {
      return
    }

    do {
      try mirror.applyPatch(PatchMessage(subscription: subscription, version: version, seq: messageUInt64(message, "seq"), ops: ops))
      for callback in patchCallbacks {
        callback(subscription, ops, version)
      }
    } catch SlopError.subscriptionGap(let expected, let received) {
      mirrors.removeValue(forKey: subscription)
      connection?.send(["type": "unsubscribe", "id": .string(subscription)])
      for callback in gapCallbacks {
        callback(subscription, expected, received)
      }
      sendSubscribe(id: subscription)
    } catch {
      assertionFailure(error.localizedDescription)
    }
  }

  private func handleResult(_ message: SlopMessage) {
    guard let id = messageString(message, "id"), let callback = pending.removeValue(forKey: id) else {
      return
    }
    if messageString(message, "status") == "error" {
      callback(.failure(SlopError.internalError(messageObject(message, "error")?["message"]?.stringValue ?? "SLOP invoke failed")))
    } else {
      callback(.success(.object(message)))
    }
  }
}
