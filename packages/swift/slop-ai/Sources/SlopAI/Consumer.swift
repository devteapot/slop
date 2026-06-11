import Foundation

public final class SlopConsumer {
  private let lock = NSRecursiveLock()
  private var connection: SlopConnection?
  private var mirrors: [String: StateMirror] = [:]
  private var subscriptions: [String: (path: String, depth: Int, options: OutputRequest)] = [:]
  private var pending: [String: (Result<JSONValue, Error>) -> Void] = [:]
  private let transport: ClientTransport
  private var connectionAttempt: UUID?
  private var connectionToken: UUID?
  private var connectionGeneration: UInt64 = 0
  private var subscriptionCounter = 0
  private var requestCounter = 0
  private var errorCallbacks: [UUID: ([String: JSONValue], String?) -> Void] = [:]
  private var eventCallbacks: [UUID: (String, JSONValue?) -> Void] = [:]
  private var patchCallbacks: [UUID: (String, [PatchOp], UInt64) -> Void] = [:]
  private var gapCallbacks: [UUID: (String, UInt64, UInt64) -> Void] = [:]
  private var disconnectCallbacks: [UUID: () -> Void] = [:]

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
    let attempt = try locked { () throws -> (token: UUID, generation: UInt64) in
      guard connection == nil, connectionAttempt == nil else {
        throw SlopError.internalError("SLOP consumer is already connected or connecting")
      }
      let token = UUID()
      connectionAttempt = token
      return (token, connectionGeneration)
    }
    return try await withTaskCancellationHandler {
      try await connect(attempt: attempt)
    } onCancel: { [weak self] in
      self?.cancelConnectionAttempt(attempt.token)
    }
  }

  private func connect(attempt: (token: UUID, generation: UInt64)) async throws -> SlopMessage {
    let connection: SlopConnection
    do {
      connection = try await transport.connect()
    } catch {
      locked {
        if connectionAttempt == attempt.token {
          connectionAttempt = nil
        }
      }
      throw error
    }
    let installed = locked { () -> Bool in
      guard
        connectionAttempt == attempt.token,
        connectionGeneration == attempt.generation,
        self.connection == nil
      else {
        return false
      }
      connectionAttempt = nil
      self.connection = connection
      connectionToken = attempt.token
      return true
    }
    guard installed else {
      connection.close()
      throw CancellationError()
    }
    let hello: SlopMessage = try await withCheckedThrowingContinuation { continuation in
      let gate = ConnectContinuationGate()
      connection.onMessage { [weak self, weak connection] message in
        guard let self else { return }
        guard self.isCurrentConnection(connection, token: attempt.token) else { return }
        if messageString(message, "type") == "hello", gate.claim() {
          do {
            _ = try parseProviderHello(message)
            continuation.resume(returning: message)
          } catch {
            continuation.resume(throwing: error)
            connection?.close()
          }
          return
        }
        self.handleMessage(message, sourceToken: attempt.token)
      }
      connection.onClose { [weak self, weak connection] in
        if gate.claim() {
          continuation.resume(throwing: SlopError.internalError("SLOP connection closed before hello"))
        }
        self?.handleDisconnect(connection)
      }
    }
    try Task.checkCancellation()
    guard locked({ connectionToken == attempt.token }) else {
      throw SlopError.internalError("SLOP connection closed during handshake")
    }
    return hello
  }

  /// Manually inject a message. Useful for tests and custom embedding layers.
  public func receive(_ message: SlopMessage) {
    handleMessage(message, sourceToken: nil)
  }

  public func subscribe(path: String = "/", depth: Int = 1, options: OutputRequest = OutputRequest()) async throws -> (id: String, snapshot: SlopNode) {
    let id = locked { () -> String in
      subscriptionCounter += 1
      let id = "sub-\(subscriptionCounter)"
      subscriptions[id] = (path, depth, options)
      return id
    }
    let snapshotValue: JSONValue
    do {
      snapshotValue = try await sendRequest(id: id) { [weak self] in
        self?.sendSubscribe(id: id)
      }
    } catch {
      locked {
        mirrors.removeValue(forKey: id)
        subscriptions.removeValue(forKey: id)
      }
      sendMessage(["type": "unsubscribe", "id": .string(id)])
      throw error
    }
    let snapshot = try decodeJSONValue(snapshotValue, as: SlopNode.self)
    return (id, snapshot)
  }

  public func unsubscribe(_ id: String) {
    let connection = locked { () -> SlopConnection? in
      mirrors.removeValue(forKey: id)
      subscriptions.removeValue(forKey: id)
      return self.connection
    }
    connection?.send(["type": "unsubscribe", "id": .string(id)])
  }

  public func query(path: String = "/", depth: Int = 1, options: OutputRequest = OutputRequest()) async throws -> SlopNode {
    let id = locked { () -> String in
      requestCounter += 1
      return "q-\(requestCounter)"
    }
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
      self?.sendMessage(message)
    }
    return try decodeJSONValue(value, as: SlopNode.self)
  }

  public func invoke(path: String, action: String, params: [String: JSONValue] = [:]) async throws -> SlopMessage {
    let id = locked { () -> String in
      requestCounter += 1
      return "inv-\(requestCounter)"
    }
    let value = try await sendRequest(id: id) { [weak self] in
      self?.sendMessage([
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
    locked { mirrors[subscriptionID]?.getTree() }
  }

  @discardableResult
  public func onError(_ callback: @escaping ([String: JSONValue], String?) -> Void) -> () -> Void {
    let token = UUID()
    locked { errorCallbacks[token] = callback }
    return { [weak self] in
      self?.removeCallback(token, from: \.errorCallbacks)
    }
  }

  @discardableResult
  public func onEvent(_ callback: @escaping (String, JSONValue?) -> Void) -> () -> Void {
    let token = UUID()
    locked { eventCallbacks[token] = callback }
    return { [weak self] in
      self?.removeCallback(token, from: \.eventCallbacks)
    }
  }

  @discardableResult
  public func onPatch(_ callback: @escaping (String, [PatchOp], UInt64) -> Void) -> () -> Void {
    let token = UUID()
    locked { patchCallbacks[token] = callback }
    return { [weak self] in
      self?.removeCallback(token, from: \.patchCallbacks)
    }
  }

  @discardableResult
  public func onGap(_ callback: @escaping (String, UInt64, UInt64) -> Void) -> () -> Void {
    let token = UUID()
    locked { gapCallbacks[token] = callback }
    return { [weak self] in
      self?.removeCallback(token, from: \.gapCallbacks)
    }
  }

  @discardableResult
  public func onDisconnect(_ callback: @escaping () -> Void) -> () -> Void {
    let token = UUID()
    locked { disconnectCallbacks[token] = callback }
    return { [weak self] in
      self?.removeCallback(token, from: \.disconnectCallbacks)
    }
  }

  public func disconnect() {
    let connection = locked { () -> SlopConnection? in
      connectionGeneration &+= 1
      connectionAttempt = nil
      let connection = self.connection
      self.connection = nil
      connectionToken = nil
      return connection
    }
    connection?.close()
  }

  private func sendRequest(id: String, send: () -> Void) async throws -> JSONValue {
    let value = try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        let registered = locked { () -> Bool in
          guard connection != nil, !Task.isCancelled else { return false }
          pending[id] = { result in
            continuation.resume(with: result)
          }
          return true
        }
        guard registered else {
          continuation.resume(throwing: Task.isCancelled ? CancellationError() : SlopError.internalError("SLOP connection is not connected"))
          return
        }
        send()
      }
    } onCancel: { [weak self] in
      self?.cancelPendingRequest(id)
    }
    try Task.checkCancellation()
    return value
  }

  private func sendSubscribe(id: String) {
    guard let subscription = locked({ subscriptions[id] }) else { return }
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
    sendMessage(message)
  }

  private func removeCallback<T>(_ token: UUID, from keyPath: ReferenceWritableKeyPath<SlopConsumer, [UUID: T]>) {
    _ = locked {
      self[keyPath: keyPath].removeValue(forKey: token)
    }
  }

  private func handleDisconnect(_ closedConnection: SlopConnection?) {
    let (pendingCallbacks, callbacks) = locked { () -> ([(Result<JSONValue, Error>) -> Void], [() -> Void]) in
      if let closedConnection, let connection, ObjectIdentifier(closedConnection) != ObjectIdentifier(connection) {
        return ([], [])
      }
      connection = nil
      connectionToken = nil
      let pendingCallbacks = Array(pending.values)
      pending.removeAll()
      return (pendingCallbacks, Array(disconnectCallbacks.values))
    }
    let error = SlopError.internalError("SLOP connection closed")
    for callback in pendingCallbacks {
      callback(.failure(error))
    }

    for callback in callbacks {
      callback()
    }
  }

  private func cancelConnectionAttempt(_ token: UUID) {
    let connection = locked { () -> SlopConnection? in
      var connectionToClose: SlopConnection?
      if connectionAttempt == token {
        connectionAttempt = nil
        connectionGeneration &+= 1
      }
      if connectionToken == token {
        connectionToClose = self.connection
        self.connection = nil
        connectionToken = nil
        connectionGeneration &+= 1
      }
      return connectionToClose
    }
    connection?.close()
  }

  private func cancelPendingRequest(_ id: String) {
    let callback = locked { pending.removeValue(forKey: id) }
    callback?(.failure(CancellationError()))
  }

  private func isCurrentConnection(_ candidate: SlopConnection?, token: UUID) -> Bool {
    locked {
      guard let candidate, let connection else { return false }
      return connectionToken == token && ObjectIdentifier(candidate) == ObjectIdentifier(connection)
    }
  }

  private func handleMessage(_ message: SlopMessage, sourceToken: UUID?) {
    switch messageString(message, "type") {
    case "snapshot":
      handleSnapshot(message, sourceToken: sourceToken)
    case "patch":
      handlePatch(message, sourceToken: sourceToken)
    case "result":
      handleResult(message, sourceToken: sourceToken)
    case "error":
      let error = messageObject(message, "error") ?? [:]
      let id = messageString(message, "id")
      let (pendingCallback, callbacks) = locked { () -> (((Result<JSONValue, Error>) -> Void)?, [([String: JSONValue], String?) -> Void]) in
        guard sourceIsValidLocked(sourceToken) else { return (nil, []) }
        let pendingCallback = id.flatMap { pending.removeValue(forKey: $0) }
        return (pendingCallback, Array(errorCallbacks.values))
      }
      if let pendingCallback {
        pendingCallback(.failure(SlopError.internalError(error["message"]?.stringValue ?? "SLOP error")))
      }
      for callback in callbacks {
        callback(error, id)
      }
    case "event":
      if let name = messageString(message, "name") {
        let callbacks = locked {
          sourceIsValidLocked(sourceToken) ? Array(eventCallbacks.values) : []
        }
        for callback in callbacks {
          callback(name, message["data"])
        }
      }
    case "batch":
      for inner in message["messages"]?.arrayValue ?? [] {
        if let object = inner.objectValue {
          handleMessage(object, sourceToken: sourceToken)
        }
      }
    default:
      break
    }
  }

  private func handleSnapshot(_ message: SlopMessage, sourceToken: UUID?) {
    guard let id = messageString(message, "id") else {
      return
    }
    guard let version = messageUInt64(message, "version") else {
      recoverInvalidSnapshot(
        id: id,
        sourceToken: sourceToken,
        error: SlopError.internalError("Snapshot \(id) is missing a valid version")
      )
      return
    }
    guard let treeValue = message["tree"], let tree = try? decodeJSONValue(treeValue, as: SlopNode.self) else {
      recoverInvalidSnapshot(
        id: id,
        sourceToken: sourceToken,
        error: SlopError.internalError("Snapshot \(id) contains an invalid tree")
      )
      return
    }

    let result = locked { () -> SnapshotHandlingResult? in
      guard sourceIsValidLocked(sourceToken) else { return nil }
      if subscriptions[id] != nil, messageUInt64(message, "seq") != 0 {
        mirrors.removeValue(forKey: id)
        let callback = pending.removeValue(forKey: id)
        if callback != nil {
          subscriptions.removeValue(forKey: id)
        }
        return .invalidSubscription(
          callback: callback,
          errorCallbacks: Array(errorCallbacks.values),
          shouldUnsubscribe: true,
          shouldResubscribe: callback == nil
        )
      }
      let existed = mirrors[id] != nil
      let callback = pending.removeValue(forKey: id)
      let shouldMirror = sourceToken == nil || subscriptions[id] != nil
      if shouldMirror, let mirror = try? StateMirror(
        snapshot: SnapshotMessage(id: id, version: version, seq: messageUInt64(message, "seq"), tree: tree)
      ) {
        mirrors[id] = mirror
      }
      return .accepted(callback: callback, patchCallbacks: callback == nil && existed ? Array(patchCallbacks.values) : [])
    }
    guard let result else { return }
    switch result {
    case .accepted(let callback, let callbacks):
      if let callback {
        callback(.success(treeValue))
      } else {
        for callback in callbacks {
          callback(id, [], version)
        }
      }
    case .invalidSubscription(let callback, let callbacks, let shouldUnsubscribe, let shouldResubscribe):
      if shouldUnsubscribe {
        sendMessage(["type": "unsubscribe", "id": .string(id)])
      }
      let error = SlopError.internalError("Subscription snapshot \(id) must carry seq 0")
      callback?(.failure(error))
      let protocolError: [String: JSONValue] = [
        "code": "invalid_snapshot",
        "message": .string(error.localizedDescription),
      ]
      for callback in callbacks {
        callback(protocolError, id)
      }
      if shouldResubscribe {
        sendSubscribe(id: id)
      }
    }
  }

  private func recoverInvalidSnapshot(id: String, sourceToken: UUID?, error: Error) {
    let recovery = locked { () -> SnapshotHandlingResult? in
      guard sourceIsValidLocked(sourceToken) else { return nil }
      let isSubscription = subscriptions[id] != nil
      mirrors.removeValue(forKey: id)
      let callback = pending.removeValue(forKey: id)
      if callback != nil, isSubscription {
        subscriptions.removeValue(forKey: id)
      }
      return .invalidSubscription(
        callback: callback,
        errorCallbacks: Array(errorCallbacks.values),
        shouldUnsubscribe: isSubscription,
        shouldResubscribe: callback == nil && isSubscription
      )
    }
    guard case .invalidSubscription(let callback, let callbacks, let shouldUnsubscribe, let shouldResubscribe)? = recovery else {
      return
    }
    if shouldUnsubscribe {
      sendMessage(["type": "unsubscribe", "id": .string(id)])
    }
    callback?(.failure(error))
    let protocolError: [String: JSONValue] = [
      "code": "invalid_snapshot",
      "message": .string(error.localizedDescription),
    ]
    for callback in callbacks {
      callback(protocolError, id)
    }
    if shouldResubscribe {
      sendSubscribe(id: id)
    }
  }

  private func handlePatch(_ message: SlopMessage, sourceToken: UUID?) {
    guard let subscription = messageString(message, "subscription") else {
      return
    }
    guard let seq = messageUInt64(message, "seq") else {
      recoverInvalidPatch(
        subscription: subscription,
        sourceToken: sourceToken,
        error: SlopError.internalError("Subscription patch \(subscription) is missing a valid seq")
      )
      return
    }
    guard let version = messageUInt64(message, "version") else {
      recoverInvalidPatch(
        subscription: subscription,
        sourceToken: sourceToken,
        error: SlopError.internalError("Subscription patch \(subscription) is missing a valid version")
      )
      return
    }
    guard let opsValue = message["ops"], let ops = try? decodeJSONValue(opsValue, as: [PatchOp].self) else {
      recoverInvalidPatch(
        subscription: subscription,
        sourceToken: sourceToken,
        error: SlopError.internalError("Subscription patch \(subscription) contains invalid operations")
      )
      return
    }

    do {
      let callbacks = try locked { () -> [(String, [PatchOp], UInt64) -> Void] in
        guard sourceIsValidLocked(sourceToken) else { return [] }
        guard let mirror = mirrors[subscription] else { return [] }
        try mirror.applyPatch(PatchMessage(subscription: subscription, version: version, seq: seq, ops: ops))
        return Array(patchCallbacks.values)
      }
      for callback in callbacks {
        callback(subscription, ops, version)
      }
    } catch SlopError.subscriptionGap(let expected, let received) {
      let recovery = locked { () -> (Bool, [(String, UInt64, UInt64) -> Void]) in
        guard sourceIsValidLocked(sourceToken) else { return (false, []) }
        mirrors.removeValue(forKey: subscription)
        return (true, Array(gapCallbacks.values))
      }
      guard recovery.0 else { return }
      sendMessage(["type": "unsubscribe", "id": .string(subscription)])
      for callback in recovery.1 {
        callback(subscription, expected, received)
      }
      sendSubscribe(id: subscription)
    } catch {
      recoverInvalidPatch(subscription: subscription, sourceToken: sourceToken, error: error)
    }
  }

  private func recoverInvalidPatch(subscription: String, sourceToken: UUID?, error: Error) {
    let recovery = locked { () -> (Bool, [([String: JSONValue], String?) -> Void]) in
      guard sourceIsValidLocked(sourceToken) else { return (false, []) }
      mirrors.removeValue(forKey: subscription)
      return (true, Array(errorCallbacks.values))
    }
    guard recovery.0 else { return }
    sendMessage(["type": "unsubscribe", "id": .string(subscription)])
    let protocolError: [String: JSONValue] = [
      "code": "invalid_patch",
      "message": .string(error.localizedDescription),
    ]
    for callback in recovery.1 {
      callback(protocolError, subscription)
    }
    sendSubscribe(id: subscription)
  }

  private func handleResult(_ message: SlopMessage, sourceToken: UUID?) {
    guard
      let id = messageString(message, "id"),
      let callback = locked({ () -> ((Result<JSONValue, Error>) -> Void)? in
        guard sourceIsValidLocked(sourceToken) else { return nil }
        return pending.removeValue(forKey: id)
      })
    else {
      return
    }
    if messageString(message, "status") == "error" {
      callback(.failure(SlopError.internalError(messageObject(message, "error")?["message"]?.stringValue ?? "SLOP invoke failed")))
    } else {
      callback(.success(.object(message)))
    }
  }

  private func sendMessage(_ message: SlopMessage) {
    let connection = locked { self.connection }
    connection?.send(message)
  }

  private func sourceIsValidLocked(_ sourceToken: UUID?) -> Bool {
    sourceToken == nil || connectionToken == sourceToken
  }

  private func locked<T>(_ body: () throws -> T) rethrows -> T {
    lock.lock()
    defer { lock.unlock() }
    return try body()
  }
}

struct ProviderHelloIdentity: Equatable {
  var id: String
  var name: String
  var slopVersion: String
  var capabilities: [String]
}

func parseProviderHello(_ message: SlopMessage) throws -> ProviderHelloIdentity {
  guard messageString(message, "type") == "hello", let provider = messageObject(message, "provider") else {
    throw SlopError.internalError("SLOP hello is missing a provider object")
  }
  guard let id = provider["id"]?.stringValue, !id.isEmpty else {
    throw SlopError.internalError("SLOP hello provider id must be a non-empty string")
  }
  guard let name = provider["name"]?.stringValue, !name.isEmpty else {
    throw SlopError.internalError("SLOP hello provider name must be a non-empty string")
  }
  guard let slopVersion = provider["slop_version"]?.stringValue, slopVersion == "0.1" else {
    throw SlopError.internalError("SLOP hello uses an unsupported protocol version")
  }
  guard
    let capabilityValues = provider["capabilities"]?.arrayValue,
    capabilityValues.allSatisfy({ $0.stringValue != nil })
  else {
    throw SlopError.internalError("SLOP hello capabilities must be an array of strings")
  }
  let capabilities = capabilityValues.compactMap(\.stringValue)
  guard capabilities.contains("state") else {
    throw SlopError.internalError("SLOP hello provider must advertise the state capability")
  }
  return ProviderHelloIdentity(id: id, name: name, slopVersion: slopVersion, capabilities: capabilities)
}

private enum SnapshotHandlingResult {
  case accepted(
    callback: ((Result<JSONValue, Error>) -> Void)?,
    patchCallbacks: [(String, [PatchOp], UInt64) -> Void]
  )
  case invalidSubscription(
    callback: ((Result<JSONValue, Error>) -> Void)?,
    errorCallbacks: [([String: JSONValue], String?) -> Void],
    shouldUnsubscribe: Bool,
    shouldResubscribe: Bool
  )
}

private final class ConnectContinuationGate {
  private let lock = NSLock()
  private var claimed = false

  func claim() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard !claimed else { return false }
    claimed = true
    return true
  }
}
