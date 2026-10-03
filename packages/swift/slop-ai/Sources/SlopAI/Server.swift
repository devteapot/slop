import Foundation

private struct ServerSubscription {
  var id: String
  var path: String
  var depth: Int
  var maxNodes: Int?
  var filter: SubscriptionFilter?
  var connectionID: ObjectIdentifier
  var connection: SlopConnection
  var lastTree: SlopNode
  var seq: UInt64
}

private struct ServerOutboundMessage {
  var connection: SlopConnection
  var message: SlopMessage
}

private struct ServerStateChange {
  var outbound: [ServerOutboundMessage] = []
  var listeners: [() -> Void] = []
}

private final class ServerMessageQueue {
  private let lock = NSLock()
  private var tail: Task<Void, Never>?

  func enqueue(_ operation: @escaping () async -> Void) {
    lock.lock()
    let previous = tail
    let next = Task {
      await previous?.value
      await operation()
    }
    tail = next
    lock.unlock()
  }
}

public final class SlopServer {
  public let id: String
  public let name: String

  private let lock = NSRecursiveLock()
  private var providerSchema: JSONValue?
  private var staticRegistrations: [String: NodeDescriptor] = [:]
  private var dynamicRegistrations: [String: () -> NodeDescriptor] = [:]
  private var decoratorActions: [String: [String: Action]] = [:]
  private var currentTree: SlopNode
  private var currentHandlers: [String: ActionHandler] = [:]
  private var currentVersion: UInt64 = 0
  private var subscriptions: [ServerSubscription] = []
  private var connections: [ObjectIdentifier: SlopConnection] = [:]
  private var connectionQueues: [ObjectIdentifier: ServerMessageQueue] = [:]
  private var changeListeners: [UUID: () -> Void] = [:]

  public init(id: String, name: String, schema: JSONValue? = nil) {
    self.id = id
    self.name = name
    providerSchema = schema
    currentTree = SlopNode(id: id, type: "root")
  }

  public var schema: JSONValue? {
    get { locked { providerSchema } }
    set { locked { providerSchema = newValue } }
  }

  public var tree: SlopNode {
    locked { currentTree }
  }

  public var version: UInt64 {
    locked { currentVersion }
  }

  public func register(_ path: String, descriptor: NodeDescriptor) throws {
    let change = try locked {
      staticRegistrations[path] = mergeDecoratorActionsLocked(path: path, descriptor: descriptor)
      dynamicRegistrations.removeValue(forKey: path)
      return try rebuildLocked()
    }
    deliver(change)
  }

  public func registerDynamic(_ path: String, descriptor: @escaping () -> NodeDescriptor) throws {
    let change = try locked {
      dynamicRegistrations[path] = descriptor
      staticRegistrations.removeValue(forKey: path)
      return try rebuildLocked()
    }
    deliver(change)
  }

  public func action(
    path: String,
    name: String,
    params: [String: ParamDef]? = nil,
    label: String? = nil,
    description: String? = nil,
    dangerous: Bool = false,
    idempotent: Bool = false,
    estimate: ActionEstimate? = nil,
    handler: @escaping ActionHandler
  ) throws {
    let change = try locked {
      decoratorActions[path, default: [:]][name] = Action(
        params: params,
        label: label,
        description: description,
        dangerous: dangerous,
        idempotent: idempotent,
        estimate: estimate,
        handler: handler
      )
      guard let descriptor = staticRegistrations[path] else {
        return ServerStateChange()
      }
      staticRegistrations[path] = mergeDecoratorActionsLocked(path: path, descriptor: descriptor)
      return try rebuildLocked()
    }
    deliver(change)
  }

  public func unregister(_ path: String, recursive: Bool = false) throws {
    let change = try locked {
      if recursive {
        let prefix = "\(path)/"
        for key in staticRegistrations.keys where key == path || key.hasPrefix(prefix) {
          staticRegistrations.removeValue(forKey: key)
        }
        for key in dynamicRegistrations.keys where key == path || key.hasPrefix(prefix) {
          dynamicRegistrations.removeValue(forKey: key)
        }
      } else {
        staticRegistrations.removeValue(forKey: path)
        dynamicRegistrations.removeValue(forKey: path)
      }
      return try rebuildLocked()
    }
    deliver(change)
  }

  public func scope(_ prefix: String) -> ScopedSlopServer {
    ScopedSlopServer(server: self, prefix: prefix)
  }

  public func refresh() throws {
    let change = try locked {
      try rebuildLocked()
    }
    deliver(change)
  }

  public func handleConnection(_ connection: SlopConnection) {
    locked {
      connections[ObjectIdentifier(connection)] = connection
    }
    connection.send(helloMessage())
  }

  public func attachConnection(_ connection: SlopConnection) {
    let queue = ServerMessageQueue()
    locked {
      connectionQueues[ObjectIdentifier(connection)] = queue
    }
    handleConnection(connection)
    connection.onMessage { [weak self, weak connection] message in
      guard let self, let connection else { return }
      queue.enqueue {
        await self.handleMessage(message, from: connection)
      }
    }
    connection.onClose { [weak self, weak connection] in
      guard let self, let connection else { return }
      self.handleDisconnect(connection)
    }
  }

  public func handleDisconnect(_ connection: SlopConnection) {
    locked {
      let id = ObjectIdentifier(connection)
      connections.removeValue(forKey: id)
      connectionQueues.removeValue(forKey: id)
      subscriptions.removeAll { $0.connectionID == id }
    }
  }

  public func emitEvent(name: String, data: JSONValue? = nil) {
    var message: SlopMessage = ["type": "event", "name": .string(name)]
    if let data {
      message["data"] = data
    }
    let targets = locked { Array(connections.values) }
    for connection in targets {
      connection.send(message)
    }
  }

  @discardableResult
  public func onChange(_ callback: @escaping () -> Void) -> () -> Void {
    let token = UUID()
    locked {
      changeListeners[token] = callback
    }
    return { [weak self] in
      guard let self else { return }
      _ = self.locked {
        self.changeListeners.removeValue(forKey: token)
      }
    }
  }

  public func stop() {
    let targets = locked { () -> [SlopConnection] in
      let targets = Array(connections.values)
      connections.removeAll()
      connectionQueues.removeAll()
      subscriptions.removeAll()
      return targets
    }
    for connection in targets {
      connection.close()
    }
  }

  public func handleMessage(_ message: SlopMessage, from connection: SlopConnection) async {
    switch messageString(message, "type") {
    case "subscribe":
      handleSubscribe(message, from: connection)
    case "unsubscribe":
      let subscriptionID = messageString(message, "id") ?? ""
      let connectionID = ObjectIdentifier(connection)
      locked {
        subscriptions.removeAll { $0.id == subscriptionID && $0.connectionID == connectionID }
      }
    case "query":
      handleQuery(message, from: connection)
    case "invoke":
      await handleInvoke(message, from: connection)
    default:
      connection.send(errorMessage(id: messageString(message, "id"), code: "bad_request", message: "Unknown message type: \(messageString(message, "type") ?? "nil")"))
    }
  }

  public func helloMessage() -> SlopMessage {
    [
      "type": "hello",
      "provider": .object([
        "id": .string(id),
        "name": .string(name),
        "slop_version": "0.1",
        "capabilities": .array(["state", "patches", "affordances", "attention", "windowing", "async", "content_refs"].map(JSONValue.string)),
      ]),
    ]
  }

  public func outputTree(_ request: OutputRequest = OutputRequest()) throws -> SlopNode {
    try locked {
      try outputTreeLocked(request)
    }
  }

  public func executeInvoke(id requestID: String, path: String, action: String, params: [String: JSONValue] = [:]) async -> SlopMessage {
    let resolution = locked { () -> (ActionHandler?, JSONSchema?) in
      (resolveHandlerLocked(path: path, action: action), resolveAffordanceLocked(path: path, action: action)?.params)
    }

    guard let handler = resolution.0 else {
      return resultMessage(id: requestID, status: "error", code: "not_found", message: "No handler for \(action) at \(path)")
    }

    if let schema = resolution.1, let error = validateParams(schema: schema, params: .object(params)) {
      return resultMessage(id: requestID, status: "error", code: "invalid_params", message: error)
    }

    do {
      let actionResult = try await handler(params)
      refreshAfterInvoke()

      switch actionResult {
      case .value(let value):
        return resultMessage(id: requestID, status: "ok", data: value)
      case .accepted(let taskID, let data):
        var resultData = data
        resultData["taskId"] = .string(taskID)
        return resultMessage(id: requestID, status: "accepted", data: .object(resultData))
      }
    } catch {
      refreshAfterInvoke()
      return resultMessage(id: requestID, status: "error", code: "internal", message: error.localizedDescription)
    }
  }

  private func refreshAfterInvoke() {
    let change = try? locked {
      try rebuildLocked()
    }
    if let change {
      deliver(change)
    }
  }

  private func handleSubscribe(_ message: SlopMessage, from connection: SlopConnection) {
    let subscriptionID = messageString(message, "id") ?? ""
    let path = messageString(message, "path") ?? "/"
    let depth = messageInt(message, "depth") ?? -1
    do {
      let snapshot = try locked { () -> SlopMessage in
        let output = try outputTreeLocked(
          OutputRequest(
            path: path,
            depth: depth,
            maxNodes: messageInt(message, "max_nodes"),
            filter: messageFilter(message)
          )
        )
        subscriptions.append(
          ServerSubscription(
            id: subscriptionID,
            path: path,
            depth: depth,
            maxNodes: messageInt(message, "max_nodes"),
            filter: messageFilter(message),
            connectionID: ObjectIdentifier(connection),
            connection: connection,
            lastTree: output,
            seq: 0
          )
        )
        return snapshotMessage(id: subscriptionID, version: currentVersion, seq: 0, tree: output)
      }
      connection.send(snapshot)
    } catch {
      connection.send(errorMessage(id: subscriptionID, code: "not_found", message: "Path \(path) does not exist in the state tree"))
    }
  }

  private func handleQuery(_ message: SlopMessage, from connection: SlopConnection) {
    let requestID = messageString(message, "id") ?? ""
    let path = messageString(message, "path") ?? "/"
    do {
      let snapshot = try locked { () -> SlopMessage in
        let output = try outputTreeLocked(
          OutputRequest(
            path: path,
            depth: messageInt(message, "depth"),
            maxNodes: messageInt(message, "max_nodes"),
            filter: messageFilter(message),
            window: messageWindow(message, "window")
          )
        )
        return snapshotMessage(id: requestID, version: currentVersion, tree: output)
      }
      connection.send(snapshot)
    } catch {
      connection.send(errorMessage(id: requestID, code: "not_found", message: "Path \(path) does not exist in the state tree"))
    }
  }

  private func handleInvoke(_ message: SlopMessage, from connection: SlopConnection) async {
    let requestID = messageString(message, "id") ?? ""
    let path = messageString(message, "path") ?? "/"
    let action = messageString(message, "action") ?? ""
    let params = messageObject(message, "params") ?? [:]
    let result = await executeInvoke(id: requestID, path: path, action: action, params: params)
    connection.send(result)
  }

  private func rebuildLocked() throws -> ServerStateChange {
    var registrations = staticRegistrations
    for (path, descriptor) in dynamicRegistrations {
      registrations[path] = mergeDecoratorActionsLocked(path: path, descriptor: descriptor())
    }
    for (path, descriptor) in staticRegistrations {
      registrations[path] = mergeDecoratorActionsLocked(path: path, descriptor: descriptor)
    }

    let result = try assembleTree(registrations: registrations, rootID: id, rootName: name)
    let ops = diffNodes(currentTree, result.tree)
    currentHandlers = result.handlers

    if !ops.isEmpty {
      currentTree = result.tree
      currentVersion += 1
      return ServerStateChange(outbound: broadcastMessagesLocked(), listeners: Array(changeListeners.values))
    }

    if currentVersion == 0 {
      currentTree = result.tree
      currentVersion = 1
    }
    return ServerStateChange()
  }

  private func broadcastMessagesLocked() -> [ServerOutboundMessage] {
    var outbound: [ServerOutboundMessage] = []
    for index in subscriptions.indices {
      let subscription = subscriptions[index]
      guard let output = try? outputTreeLocked(
        OutputRequest(
          path: subscription.path,
          depth: subscription.depth,
          maxNodes: subscription.maxNodes,
          filter: subscription.filter
        )
      ) else {
        continue
      }
      let ops = diffNodes(subscription.lastTree, output)
      subscriptions[index].lastTree = output
      guard !ops.isEmpty else { continue }
      subscriptions[index].seq += 1
      outbound.append(
        ServerOutboundMessage(
          connection: subscription.connection,
          message: patchMessage(
            subscription: subscription.id,
            version: currentVersion,
            seq: subscriptions[index].seq,
            ops: ops
          )
        )
      )
    }
    return outbound
  }

  private func outputTreeLocked(_ request: OutputRequest = OutputRequest()) throws -> SlopNode {
    var output: SlopNode
    if let path = request.path, !path.isEmpty, path != "/" {
      guard let subtree = getSubtree(currentTree, path: path) else {
        throw SlopError.notFound("Path \(path) does not exist in the state tree")
      }
      output = subtree
    } else {
      output = currentTree
    }

    output = prepareTree(
      output,
      options: OutputTreeOptions(
        maxDepth: request.depth != nil && request.depth! >= 0 ? request.depth : nil,
        maxNodes: request.maxNodes,
        minSalience: request.filter?.minSalience,
        types: request.filter?.types
      )
    )

    if let window = request.window, let children = output.children {
      let offset = max(0, min(window.offset, children.count))
      let count = max(0, min(window.count, children.count - offset))
      let end = offset + count
      let sliced = Array(children[offset..<end])
      var meta = output.meta ?? NodeMeta()
      meta.totalChildren = children.count
      meta.window = WindowRange(offset, sliced.count)
      output.children = sliced
      output.meta = meta
    }

    return output
  }

  private func mergeDecoratorActionsLocked(path: String, descriptor: NodeDescriptor) -> NodeDescriptor {
    guard let actions = decoratorActions[path], !actions.isEmpty else {
      return descriptor
    }
    var descriptor = descriptor
    var merged = descriptor.actions ?? [:]
    for (name, action) in actions {
      merged[name] = action
    }
    descriptor.actions = merged
    return descriptor
  }

  private func resolveHandlerLocked(path: String, action: String) -> ActionHandler? {
    var cleanPath = path
    let rootPrefix = "/\(id)/"
    if cleanPath.hasPrefix(rootPrefix) {
      cleanPath = String(cleanPath.dropFirst(rootPrefix.count))
    } else if cleanPath.hasPrefix("/") {
      cleanPath = String(cleanPath.dropFirst())
    }
    let key = cleanPath.isEmpty ? action : "\(cleanPath)/\(action)"
    return currentHandlers[key]
  }

  private func resolveAffordanceLocked(path: String, action: String) -> Affordance? {
    let rootPrefix = "/\(id)"
    var treePath = path
    if treePath == rootPrefix {
      treePath = "/"
    } else if treePath.hasPrefix("\(rootPrefix)/") {
      treePath = String(treePath.dropFirst(rootPrefix.count))
    }
    let node = treePath == "/" ? currentTree : getSubtree(currentTree, path: treePath)
    return node?.affordances?.first { $0.action == action }
  }

  private func deliver(_ change: ServerStateChange) {
    for item in change.outbound {
      item.connection.send(item.message)
    }
    for listener in change.listeners {
      listener()
    }
  }

  private func locked<T>(_ body: () throws -> T) rethrows -> T {
    lock.lock()
    defer { lock.unlock() }
    return try body()
  }
}

public struct ScopedSlopServer {
  private let server: SlopServer
  private let prefix: String

  init(server: SlopServer, prefix: String) {
    self.server = server
    self.prefix = prefix
  }

  public func register(_ path: String, descriptor: NodeDescriptor) throws {
    try server.register("\(prefix)/\(path)", descriptor: descriptor)
  }

  public func unregister(_ path: String, recursive: Bool = false) throws {
    try server.unregister("\(prefix)/\(path)", recursive: recursive)
  }

  public func scope(_ path: String) -> ScopedSlopServer {
    server.scope("\(prefix)/\(path)")
  }
}
