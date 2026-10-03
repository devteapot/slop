import Foundation
import NIOCore
import NIOHTTP1
import NIOPosix
import NIOWebSocket

public let defaultBridgeURL = "ws://127.0.0.1:9339/slop-bridge"
public let defaultBridgeHost = "127.0.0.1"
public let defaultBridgePort = 9339
public let defaultBridgePath = "/slop-bridge"

private func bridgeReconnectDelayNanoseconds(_ delay: TimeInterval) -> UInt64 {
  guard !delay.isNaN, delay > 0 else { return 0 }
  guard delay.isFinite else { return UInt64.max }
  let nanoseconds = delay * 1_000_000_000
  guard nanoseconds < Double(UInt64.max) else { return UInt64.max }
  return UInt64(nanoseconds)
}

public struct BridgeProvider: Equatable {
  public var providerKey: String
  public var tabID: Int
  public var id: String
  public var name: String
  public var transport: String
  public var url: String?

  public init(
    providerKey: String,
    tabID: Int = 0,
    id: String? = nil,
    name: String? = nil,
    transport: String = "postmessage",
    url: String? = nil
  ) {
    self.providerKey = providerKey
    self.tabID = tabID
    self.id = id ?? providerKey
    self.name = name ?? "Tab"
    self.transport = transport
    self.url = url
  }
}

public typealias BridgeRelayHandler = (SlopMessage) -> Void

public protocol DiscoveryBridge: AnyObject {
  var running: Bool { get }
  func providers() -> [BridgeProvider]
  @discardableResult
  func onProviderChange(_ callback: @escaping () -> Void) -> () -> Void
  @discardableResult
  func onDisconnect(_ callback: @escaping () -> Void) -> () -> Void
  @discardableResult
  func subscribeRelay(providerKey: String, handler: @escaping BridgeRelayHandler) -> () -> Void
  func send(_ message: SlopMessage) async throws
  func stop()
}

public func parseBridgeProvider(_ message: SlopMessage) -> BridgeProvider? {
  guard let providerKey = message["providerKey"]?.stringValue, !providerKey.isEmpty else {
    return nil
  }
  let tabID = message["tabId"]?.intValue ?? 0
  let provider = message["provider"]?.objectValue ?? [:]
  return BridgeProvider(
    providerKey: providerKey,
    tabID: tabID,
    id: provider["id"]?.stringValue,
    name: provider["name"]?.stringValue,
    transport: provider["transport"]?.stringValue ?? "postmessage",
    url: provider["url"]?.stringValue
  )
}

public func bridgeProviderToDescriptor(_ provider: BridgeProvider) -> ProviderDescriptor {
  let transport: ProviderTransport
  if provider.transport == "ws", let url = provider.url, !url.isEmpty {
    transport = ProviderTransport(type: .ws, url: url)
  } else {
    transport = ProviderTransport(type: .relay)
  }

  return ProviderDescriptor(
    id: provider.providerKey,
    name: provider.name,
    slopVersion: "1.0",
    transport: transport,
    capabilities: [],
    providerKey: provider.providerKey,
    source: "bridge"
  )
}

public final class BridgeRelayTransport: ClientTransport {
  private let bridge: DiscoveryBridge
  private let providerKey: String

  public init(bridge: DiscoveryBridge, providerKey: String) {
    self.bridge = bridge
    self.providerKey = providerKey
  }

  public func connect() async throws -> SlopConnection {
    let responseFlag = RelayResponseFlag()
    let providerKey = self.providerKey
    var connection: BridgeRelayConnection!
    let unsubscribeRelay = bridge.subscribeRelay(providerKey: providerKey) { message in
      responseFlag.mark()
      connection?.receive(message)
    }
    let unsubscribeDisconnect = bridge.onDisconnect {
      connection?.bridgeDidDisconnect()
    }
    let unsubscribeProviderChange = bridge.onProviderChange { [weak bridge] in
      guard bridge?.providers().contains(where: { $0.providerKey == providerKey }) == false else { return }
      connection?.bridgeDidDisconnect()
    }
    connection = BridgeRelayConnection(
      bridge: bridge,
      providerKey: providerKey,
      unsubscribe: {
        unsubscribeRelay()
        unsubscribeDisconnect()
        unsubscribeProviderChange()
      }
    )

    do {
      try await bridge.send(["type": "relay-open", "providerKey": .string(providerKey)])
      for _ in 0...3 {
        try await bridge.send([
          "type": "slop-relay",
          "providerKey": .string(providerKey),
          "message": .object(["type": "connect"]),
        ])
        if await responseFlag.wait(milliseconds: 300) {
          break
        }
      }
      return connection
    } catch {
      connection.bridgeDidDisconnect()
      throw error
    }
  }
}

public final class BridgeRelayConnection: SlopConnection {
  private let bridge: DiscoveryBridge
  private let providerKey: String
  private let unsubscribe: () -> Void
  private let lock = NSLock()
  private var messageHandlers: [(SlopMessage) -> Void] = []
  private var closeHandlers: [() -> Void] = []
  private var earlyMessages: [SlopMessage] = []
  private var buffering = true
  private var closed = false
  private var sendTail: Task<Void, Never>?

  init(bridge: DiscoveryBridge, providerKey: String, unsubscribe: @escaping () -> Void) {
    self.bridge = bridge
    self.providerKey = providerKey
    self.unsubscribe = unsubscribe
  }

  public func send(_ message: SlopMessage) {
    lock.lock()
    guard !closed else {
      lock.unlock()
      return
    }
    let previous = sendTail
    let next = Task { [weak self, bridge, providerKey] in
      await previous?.value
      guard self?.isOpen == true else { return }
      do {
        try await bridge.send([
          "type": "slop-relay",
          "providerKey": .string(providerKey),
          "message": .object(message),
        ])
      } catch {
        self?.finishClose(notifyBridge: false)
      }
    }
    sendTail = next
    lock.unlock()
  }

  public func onMessage(_ handler: @escaping (SlopMessage) -> Void) {
    lock.lock()
    messageHandlers.append(handler)
    let replay = earlyMessages
    earlyMessages.removeAll()
    buffering = false
    lock.unlock()

    for message in replay {
      handler(message)
    }
  }

  public func onClose(_ handler: @escaping () -> Void) {
    lock.lock()
    let alreadyClosed = closed
    if !alreadyClosed {
      closeHandlers.append(handler)
    }
    lock.unlock()
    if alreadyClosed {
      handler()
    }
  }

  public func close() {
    finishClose(notifyBridge: true)
  }

  func bridgeDidDisconnect() {
    finishClose(notifyBridge: false)
  }

  private func finishClose(notifyBridge: Bool) {
    lock.lock()
    guard !closed else {
      lock.unlock()
      return
    }
    closed = true
    let handlers = closeHandlers
    let previousSend = sendTail
    closeHandlers.removeAll()
    lock.unlock()

    if notifyBridge {
      Task { [bridge, providerKey] in
        await previousSend?.value
        try? await bridge.send(["type": "relay-close", "providerKey": .string(providerKey)])
      }
    }
    unsubscribe()
    for handler in handlers {
      handler()
    }
  }

  func receive(_ message: SlopMessage) {
    lock.lock()
    guard !closed else {
      lock.unlock()
      return
    }
    if buffering {
      earlyMessages.append(message)
    }
    let handlers = messageHandlers
    lock.unlock()

    for handler in handlers {
      handler(message)
    }
  }

  private var isOpen: Bool {
    lock.lock()
    defer { lock.unlock() }
    return !closed
  }
}

private struct BridgeConnectionAttempt {
  var token: UUID
  var generation: UInt64
  var task: Task<SlopConnection, Error>
}

public final class BridgeClient: DiscoveryBridge {
  private let url: URL
  private let reconnectDelayNanoseconds: UInt64
  private let transportFactory: () -> ClientTransport
  private let lock = NSLock()
  private var connection: SlopConnection?
  private var providerMap: [String: BridgeProvider] = [:]
  private var relaySubscribers: [String: [UUID: BridgeRelayHandler]] = [:]
  private var changeCallbacks: [UUID: () -> Void] = [:]
  private var disconnectCallbacks: [UUID: () -> Void] = [:]
  private var started = false
  private var reconnectTask: Task<Void, Never>?
  private var connectionAttempt: BridgeConnectionAttempt?
  private var lifecycleGeneration: UInt64 = 0

  public init(url: URL = URL(string: defaultBridgeURL)!, reconnectDelay: TimeInterval = 5.0) {
    self.url = url
    reconnectDelayNanoseconds = bridgeReconnectDelayNanoseconds(reconnectDelay)
    transportFactory = { URLSessionWebSocketTransport(url: url) }
  }

  init(
    url: URL = URL(string: defaultBridgeURL)!,
    reconnectDelay: TimeInterval = 5.0,
    transportFactory: @escaping () -> ClientTransport
  ) {
    self.url = url
    reconnectDelayNanoseconds = bridgeReconnectDelayNanoseconds(reconnectDelay)
    self.transportFactory = transportFactory
  }

  public var running: Bool {
    locked { connection != nil }
  }

  public func connectOnce() async throws {
    let attempt = locked { () -> BridgeConnectionAttempt? in
      guard self.connection == nil else { return nil }
      if let connectionAttempt {
        return connectionAttempt
      }
      let token = UUID()
      let generation = lifecycleGeneration
      let transportFactory = self.transportFactory
      let task = Task<SlopConnection, Error> {
        try await transportFactory().connect()
      }
      let attempt = BridgeConnectionAttempt(token: token, generation: generation, task: task)
      connectionAttempt = attempt
      return attempt
    }
    guard let attempt else { return }

    let connection: SlopConnection
    do {
      connection = try await attempt.task.value
    } catch {
      locked {
        if connectionAttempt?.token == attempt.token {
          connectionAttempt = nil
        }
      }
      throw error
    }

    let installation = locked { () -> (accepted: Bool, installed: Bool) in
      if let current = self.connection, ObjectIdentifier(current) == ObjectIdentifier(connection) {
        return (true, false)
      }
      guard
        connectionAttempt?.token == attempt.token,
        lifecycleGeneration == attempt.generation,
        self.connection == nil
      else {
        return (false, false)
      }
      connectionAttempt = nil
      self.connection = connection
      return (true, true)
    }
    guard installation.accepted else {
      connection.close()
      throw CancellationError()
    }
    guard installation.installed else { return }

    connection.onMessage { [weak self, weak connection] message in
      self?.handleBridgeMessage(message, from: connection)
    }
    connection.onClose { [weak self, weak connection] in
      guard let self else { return }
      self.handleDisconnect(connection)
    }
    guard locked({ self.connection.map(ObjectIdentifier.init) == ObjectIdentifier(connection) }) else {
      throw CancellationError()
    }
  }

  public func start() {
    lock.lock()
    guard !started else {
      lock.unlock()
      return
    }
    started = true
    lock.unlock()

    scheduleReconnect(immediately: true)
  }

  public func stop() {
    lock.lock()
    guard started || connection != nil || connectionAttempt != nil || !providerMap.isEmpty else {
      lock.unlock()
      return
    }
    started = false
    lifecycleGeneration &+= 1
    reconnectTask?.cancel()
    reconnectTask = nil
    let connectionTask = connectionAttempt?.task
    connectionAttempt = nil
    let connection = connection
    self.connection = nil
    let changed = !providerMap.isEmpty
    providerMap.removeAll()
    relaySubscribers.removeAll()
    let callbacks = Array(changeCallbacks.values)
    let lifecycleCallbacks = Array(disconnectCallbacks.values)
    lock.unlock()

    connectionTask?.cancel()
    for callback in lifecycleCallbacks {
      callback()
    }
    connection?.close()
    if changed {
      for callback in callbacks {
        callback()
      }
    }
  }

  public func providers() -> [BridgeProvider] {
    lock.lock()
    let providers = Array(providerMap.values)
    lock.unlock()
    return providers
  }

  @discardableResult
  public func onProviderChange(_ callback: @escaping () -> Void) -> () -> Void {
    let token = UUID()
    lock.lock()
    changeCallbacks[token] = callback
    lock.unlock()
    return { [weak self] in
      self?.lock.lock()
      self?.changeCallbacks.removeValue(forKey: token)
      self?.lock.unlock()
    }
  }

  @discardableResult
  public func onDisconnect(_ callback: @escaping () -> Void) -> () -> Void {
    let token = UUID()
    lock.lock()
    disconnectCallbacks[token] = callback
    lock.unlock()
    return { [weak self] in
      self?.lock.lock()
      self?.disconnectCallbacks.removeValue(forKey: token)
      self?.lock.unlock()
    }
  }

  @discardableResult
  public func subscribeRelay(providerKey: String, handler: @escaping BridgeRelayHandler) -> () -> Void {
    let token = UUID()
    lock.lock()
    relaySubscribers[providerKey, default: [:]][token] = handler
    lock.unlock()
    return { [weak self] in
      self?.lock.lock()
      self?.relaySubscribers[providerKey]?.removeValue(forKey: token)
      if self?.relaySubscribers[providerKey]?.isEmpty == true {
        self?.relaySubscribers.removeValue(forKey: providerKey)
      }
      self?.lock.unlock()
    }
  }

  public func send(_ message: SlopMessage) async throws {
    let connection: SlopConnection? = locked { self.connection }
    guard let connection else {
      throw SlopError.internalError("Bridge client is not connected")
    }
    connection.send(message)
  }

  private func scheduleReconnect(immediately: Bool = false) {
    lock.lock()
    guard started, reconnectTask == nil else {
      lock.unlock()
      return
    }
    let delay = immediately ? 0 : reconnectDelayNanoseconds
    reconnectTask = Task { [weak self] in
      if delay > 0 {
        try? await Task.sleep(nanoseconds: delay)
      }
      guard let self else { return }
      while !Task.isCancelled {
        do {
          try await self.connectOnce()
          let shouldReschedule = self.locked {
            self.reconnectTask = nil
            return self.started && self.connection == nil
          }
          if shouldReschedule {
            self.scheduleReconnect(immediately: true)
          }
          return
        } catch {
          try? await Task.sleep(nanoseconds: self.reconnectDelayNanoseconds)
        }
      }
    }
    lock.unlock()
  }

  private func handleBridgeMessage(_ message: SlopMessage, from source: SlopConnection?) {
    switch message["type"]?.stringValue {
    case "provider-available":
      guard let provider = parseBridgeProvider(message) else { return }
      let callbacks = locked { () -> [() -> Void]? in
        guard isCurrentConnectionLocked(source) else { return nil }
        providerMap[provider.providerKey] = provider
        return Array(changeCallbacks.values)
      }
      guard let callbacks else { return }
      for callback in callbacks {
        guard isCurrentConnection(source) else { return }
        callback()
      }
    case "provider-unavailable":
      guard let providerKey = message["providerKey"]?.stringValue, !providerKey.isEmpty else { return }
      let callbacks = locked { () -> [() -> Void]? in
        guard isCurrentConnectionLocked(source) else { return nil }
        providerMap.removeValue(forKey: providerKey)
        relaySubscribers.removeValue(forKey: providerKey)
        return Array(changeCallbacks.values)
      }
      guard let callbacks else { return }
      for callback in callbacks {
        guard isCurrentConnection(source) else { return }
        callback()
      }
    case "slop-relay":
      guard
        let providerKey = message["providerKey"]?.stringValue,
        let payload = message["message"]?.objectValue
      else {
        return
      }
      let subscribers = locked { () -> [BridgeRelayHandler]? in
        guard isCurrentConnectionLocked(source) else { return nil }
        return relaySubscribers[providerKey].map { Array($0.values) } ?? []
      }
      guard let subscribers else { return }
      for subscriber in subscribers {
        guard isCurrentConnection(source) else { return }
        subscriber(payload)
      }
    default:
      break
    }
  }

  private func handleDisconnect(_ connection: SlopConnection?) {
    lock.lock()
    guard
      let connection,
      let current = self.connection,
      ObjectIdentifier(connection) == ObjectIdentifier(current)
    else {
      lock.unlock()
      return
    }
    self.connection = nil
    let changed = !providerMap.isEmpty
    providerMap.removeAll()
    relaySubscribers.removeAll()
    let callbacks = Array(changeCallbacks.values)
    let lifecycleCallbacks = Array(disconnectCallbacks.values)
    let shouldReconnect = started
    lock.unlock()

    for callback in lifecycleCallbacks {
      callback()
    }
    if changed {
      for callback in callbacks {
        callback()
      }
    }
    if shouldReconnect {
      scheduleReconnect()
    }
  }

  private func lockedChange(_ body: () -> Void) -> [() -> Void] {
    lock.lock()
    body()
    let callbacks = Array(changeCallbacks.values)
    lock.unlock()
    return callbacks
  }

  private func isCurrentConnection(_ candidate: SlopConnection?) -> Bool {
    locked { isCurrentConnectionLocked(candidate) }
  }

  private func isCurrentConnectionLocked(_ candidate: SlopConnection?) -> Bool {
    guard let candidate, let connection else { return false }
    return ObjectIdentifier(candidate) == ObjectIdentifier(connection)
  }

  private func locked<T>(_ body: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return body()
  }
}

public final class BridgeServer: DiscoveryBridge {
  private let host: String
  private let listenPort: Int
  private let path: String
  private let allowedOrigins: [String]?
  private let authenticate: WebSocketUpgradeAuthenticator?
  private let state = BridgeServerState()
  private var group: EventLoopGroup?
  private var channel: Channel?

  public init(
    host: String = defaultBridgeHost,
    port: Int = defaultBridgePort,
    path: String = defaultBridgePath,
    allowedOrigins: [String]? = nil,
    authenticate: WebSocketUpgradeAuthenticator? = nil
  ) {
    self.host = host
    listenPort = port
    self.path = path
    self.allowedOrigins = allowedOrigins
    self.authenticate = authenticate
  }

  public var running: Bool {
    state.running
  }

  public var url: String? {
    guard let port = channel?.localAddress?.port else { return nil }
    return "ws://\(host):\(port)\(path)"
  }

  public func start() throws {
    guard !state.running else { return }
    let group = MultiThreadedEventLoopGroup(numberOfThreads: max(1, System.coreCount))
    let bootstrap = ServerBootstrap(group: group)
      .serverChannelOption(ChannelOptions.backlog, value: 64)
      .serverChannelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
      .childChannelInitializer { [state, path, allowedOrigins, authenticate] channel in
        let fallbackHandlerName = "SlopBridgeHTTPFallbackHandler"
        let upgradeGuardName = "SlopBridgeWebSocketUpgradeGuardHandler"
        let upgrader = NIOWebSocketServerUpgrader(
          maxFrameSize: 1 << 20,
          shouldUpgrade: { channel, _ in
            channel.eventLoop.makeSucceededFuture(HTTPHeaders())
          },
          upgradePipelineHandler: { channel, _ in
            channel.pipeline.removeHandler(name: fallbackHandlerName).flatMap {
              channel.pipeline.removeHandler(name: upgradeGuardName)
            }.flatMap {
              do {
                try channel.pipeline.syncOperations.addHandler(makeWebSocketFrameAggregator())
                return channel.pipeline.addHandler(BridgeServerWebSocketHandler(state: state))
              } catch {
                return channel.eventLoop.makeFailedFuture(error)
              }
            }
          }
        )
        let upgradeConfig = NIOHTTPServerUpgradeConfiguration(upgraders: [upgrader], completionHandler: { _ in })
        return channel.pipeline.configureHTTPServerPipeline(
          withPipeliningAssistance: false,
          withServerUpgrade: upgradeConfig
        ).flatMap {
          do {
            let upgradeContext = try channel.pipeline.syncOperations.context(handlerType: HTTPServerUpgradeHandler.self)
            try channel.pipeline.syncOperations.addHandler(
              WebSocketUpgradeGuardHandler(
                path: path,
                allowedOrigins: allowedOrigins,
                authenticate: authenticate
              ),
              name: upgradeGuardName,
              position: .before(upgradeContext.handler)
            )
            return channel.eventLoop.makeSucceededVoidFuture()
          } catch {
            return channel.eventLoop.makeFailedFuture(error)
          }
        }.flatMap {
          channel.pipeline.addHandler(BridgeHTTPFallbackHandler(webSocketPath: path), name: fallbackHandlerName)
        }
      }

    do {
      channel = try bootstrap.bind(host: host, port: listenPort).wait()
      self.group = group
      state.setRunning(true)
    } catch {
      try? group.syncShutdownGracefully()
      throw SlopError.internalError("Bridge server listen failed: \(error.localizedDescription)")
    }
  }

  public func stop() {
    guard state.running else { return }
    state.setRunning(false)
    try? channel?.close().wait()
    channel = nil
    try? group?.syncShutdownGracefully()
    group = nil
    state.clear()
  }

  public func providers() -> [BridgeProvider] {
    state.providers()
  }

  @discardableResult
  public func onProviderChange(_ callback: @escaping () -> Void) -> () -> Void {
    state.onProviderChange(callback)
  }

  @discardableResult
  public func onDisconnect(_ callback: @escaping () -> Void) -> () -> Void {
    state.onDisconnect(callback)
  }

  @discardableResult
  public func subscribeRelay(providerKey: String, handler: @escaping BridgeRelayHandler) -> () -> Void {
    state.subscribeRelay(providerKey: providerKey, handler: handler)
  }

  public func send(_ message: SlopMessage) async throws {
    state.broadcast(message)
  }
}

private final class BridgeServerWebSocketHandler: ChannelDuplexHandler {
  typealias InboundIn = WebSocketFrame
  typealias OutboundIn = WebSocketFrame
  typealias OutboundOut = WebSocketFrame

  private let state: BridgeServerState
  private var connection: NIOWebSocketConnection?

  init(state: BridgeServerState) {
    self.state = state
  }

  func handlerAdded(context: ChannelHandlerContext) {
    let connection = NIOWebSocketConnection(channel: context.channel)
    self.connection = connection
    state.addSink(connection)
  }

  func channelRead(context: ChannelHandlerContext, data: NIOAny) {
    let frame = unwrapInboundIn(data)
    switch frame.opcode {
    case .ping:
      let pong = WebSocketFrame(fin: true, opcode: .pong, data: frame.unmaskedData)
      context.writeAndFlush(wrapOutboundOut(pong), promise: nil)
    case .text:
      var payload = frame.unmaskedData
      guard
        let text = payload.readString(length: payload.readableBytes),
        let data = text.data(using: .utf8),
        case .object(let message) = try? JSONDecoder().decode(JSONValue.self, from: data)
      else {
        return
      }
      state.handle(message, from: connection)
    case .binary:
      var payload = frame.unmaskedData
      guard
        let bytes = payload.readBytes(length: payload.readableBytes),
        case .object(let message) = try? JSONDecoder().decode(JSONValue.self, from: Data(bytes))
      else {
        return
      }
      state.handle(message, from: connection)
    case .connectionClose:
      connection?.fireClose()
      context.close(promise: nil)
    default:
      break
    }
  }

  func channelInactive(context: ChannelHandlerContext) {
    if let connection {
      state.removeSink(connection)
      connection.fireClose()
    }
  }
}

private final class BridgeHTTPFallbackHandler: ChannelInboundHandler, RemovableChannelHandler {
  typealias InboundIn = HTTPServerRequestPart
  typealias OutboundOut = HTTPServerResponsePart

  private let webSocketPath: String
  private var head: HTTPRequestHead?

  init(webSocketPath: String) {
    self.webSocketPath = webSocketPath
  }

  func channelRead(context: ChannelHandlerContext, data: NIOAny) {
    switch unwrapInboundIn(data) {
    case .head(let head):
      self.head = head
    case .body:
      break
    case .end:
      guard let head else {
        sendResponse(status: .badRequest, body: "Bad Request", context: context)
        return
      }
      let isRejectedUpgrade = requestPath(head.uri) == webSocketPath
        && head.headers.first(name: "Upgrade")?.lowercased() == "websocket"
      sendResponse(
        status: isRejectedUpgrade ? .forbidden : .notFound,
        body: isRejectedUpgrade ? "Forbidden" : "Not Found",
        context: context
      )
      self.head = nil
    }
  }

  func errorCaught(context: ChannelHandlerContext, error: Error) {
    if error is NIOWebSocketUpgradeError {
      sendResponse(status: .forbidden, body: "Forbidden", context: context)
    } else {
      context.close(promise: nil)
    }
  }

  private func sendResponse(status: HTTPResponseStatus, body: String, context: ChannelHandlerContext) {
    let buffer = context.channel.allocator.buffer(string: body)
    var headers = HTTPHeaders()
    headers.add(name: "Content-Type", value: "text/plain; charset=utf-8")
    headers.add(name: "Content-Length", value: "\(buffer.readableBytes)")
    headers.add(name: "Connection", value: "close")
    let responseHead = HTTPResponseHead(version: head?.version ?? .http1_1, status: status, headers: headers)
    context.write(wrapOutboundOut(.head(responseHead)), promise: nil)
    context.write(wrapOutboundOut(.body(.byteBuffer(buffer))), promise: nil)
    context.writeAndFlush(wrapOutboundOut(.end(nil))).whenComplete { _ in
      context.close(promise: nil)
    }
  }
}

private final class BridgeServerState {
  private let lock = NSLock()
  private var sinkMap: [ObjectIdentifier: SlopConnection] = [:]
  private var providerMap: [String: BridgeProvider] = [:]
  private var providerOwners: [String: ObjectIdentifier] = [:]
  private var relaySubscribers: [String: [UUID: BridgeRelayHandler]] = [:]
  private var changeCallbacks: [UUID: () -> Void] = [:]
  private var disconnectCallbacks: [UUID: () -> Void] = [:]
  private var isRunning = false

  var running: Bool {
    lock.lock()
    let value = isRunning
    lock.unlock()
    return value
  }

  func setRunning(_ value: Bool) {
    lock.lock()
    isRunning = value
    lock.unlock()
  }

  func providers() -> [BridgeProvider] {
    lock.lock()
    let values = Array(providerMap.values)
    lock.unlock()
    return values
  }

  func addSink(_ sink: SlopConnection) {
    lock.lock()
    sinkMap[ObjectIdentifier(sink)] = sink
    let providers = Array(providerMap.values)
    lock.unlock()

    for provider in providers {
      sink.send(providerAvailableMessage(provider))
    }
  }

  func removeSink(_ sink: SlopConnection) {
    let callbacks: [() -> Void]
    let remainingSinks: [SlopConnection]
    let removedProviderKeys: [String]
    lock.lock()
    let sinkID = ObjectIdentifier(sink)
    sinkMap.removeValue(forKey: sinkID)
    removedProviderKeys = providerOwners.compactMap { providerKey, owner in
      owner == sinkID ? providerKey : nil
    }
    for providerKey in removedProviderKeys {
      providerMap.removeValue(forKey: providerKey)
      providerOwners.removeValue(forKey: providerKey)
      relaySubscribers.removeValue(forKey: providerKey)
    }
    remainingSinks = Array(sinkMap.values)
    callbacks = removedProviderKeys.isEmpty ? [] : Array(changeCallbacks.values)
    lock.unlock()

    for providerKey in removedProviderKeys {
      let message: SlopMessage = ["type": "provider-unavailable", "providerKey": .string(providerKey)]
      for remainingSink in remainingSinks {
        remainingSink.send(message)
      }
    }
    for callback in callbacks {
      callback()
    }
  }

  @discardableResult
  func onProviderChange(_ callback: @escaping () -> Void) -> () -> Void {
    let token = UUID()
    lock.lock()
    changeCallbacks[token] = callback
    lock.unlock()
    return { [weak self] in
      self?.lock.lock()
      self?.changeCallbacks.removeValue(forKey: token)
      self?.lock.unlock()
    }
  }

  @discardableResult
  func onDisconnect(_ callback: @escaping () -> Void) -> () -> Void {
    let token = UUID()
    lock.lock()
    disconnectCallbacks[token] = callback
    lock.unlock()
    return { [weak self] in
      self?.lock.lock()
      self?.disconnectCallbacks.removeValue(forKey: token)
      self?.lock.unlock()
    }
  }

  @discardableResult
  func subscribeRelay(providerKey: String, handler: @escaping BridgeRelayHandler) -> () -> Void {
    let token = UUID()
    lock.lock()
    relaySubscribers[providerKey, default: [:]][token] = handler
    lock.unlock()
    return { [weak self] in
      self?.lock.lock()
      self?.relaySubscribers[providerKey]?.removeValue(forKey: token)
      if self?.relaySubscribers[providerKey]?.isEmpty == true {
        self?.relaySubscribers.removeValue(forKey: providerKey)
      }
      self?.lock.unlock()
    }
  }

  func handle(_ message: SlopMessage, from source: SlopConnection?) {
    switch message["type"]?.stringValue {
    case "provider-available":
      guard let provider = parseBridgeProvider(message), let source else { return }
      let callbacks = lockedChange {
        providerMap[provider.providerKey] = provider
        providerOwners[provider.providerKey] = ObjectIdentifier(source)
      }
      broadcast(message)
      for callback in callbacks {
        callback()
      }
    case "provider-unavailable":
      guard let providerKey = message["providerKey"]?.stringValue, !providerKey.isEmpty else { return }
      guard let source else { return }
      lock.lock()
      guard providerOwners[providerKey] == ObjectIdentifier(source) else {
        lock.unlock()
        return
      }
      providerMap.removeValue(forKey: providerKey)
      providerOwners.removeValue(forKey: providerKey)
      relaySubscribers.removeValue(forKey: providerKey)
      let callbacks = Array(changeCallbacks.values)
      lock.unlock()
      broadcast(message)
      for callback in callbacks {
        callback()
      }
    case "slop-relay":
      guard
        let providerKey = message["providerKey"]?.stringValue,
        let payload = message["message"]?.objectValue
      else {
        return
      }
      lock.lock()
      let subscribers = relaySubscribers[providerKey].map { Array($0.values) } ?? []
      lock.unlock()
      for subscriber in subscribers {
        subscriber(payload)
      }
      broadcast(message)
    case "relay-open", "relay-close":
      broadcast(message)
    default:
      break
    }
  }

  func broadcast(_ message: SlopMessage) {
    lock.lock()
    let sinks = Array(sinkMap.values)
    lock.unlock()

    for sink in sinks {
      sink.send(message)
    }
  }

  func clear() {
    let callbacks: [() -> Void]
    let lifecycleCallbacks: [() -> Void]
    lock.lock()
    let changed = !providerMap.isEmpty
    providerMap.removeAll()
    providerOwners.removeAll()
    relaySubscribers.removeAll()
    sinkMap.removeAll()
    callbacks = changed ? Array(changeCallbacks.values) : []
    lifecycleCallbacks = Array(disconnectCallbacks.values)
    lock.unlock()

    for callback in lifecycleCallbacks {
      callback()
    }
    for callback in callbacks {
      callback()
    }
  }

  private func lockedChange(_ body: () -> Void) -> [() -> Void] {
    lock.lock()
    body()
    let callbacks = Array(changeCallbacks.values)
    lock.unlock()
    return callbacks
  }

  private func providerAvailableMessage(_ provider: BridgeProvider) -> SlopMessage {
    var providerObject: [String: JSONValue] = [
      "id": .string(provider.id),
      "name": .string(provider.name),
      "transport": .string(provider.transport),
    ]
    if let url = provider.url {
      providerObject["url"] = .string(url)
    }
    return [
      "type": "provider-available",
      "tabId": .number(Double(provider.tabID)),
      "providerKey": .string(provider.providerKey),
      "provider": .object(providerObject),
    ]
  }
}

private final class RelayResponseFlag {
  private let lock = NSLock()
  private var seen = false

  func mark() {
    lock.lock()
    seen = true
    lock.unlock()
  }

  func wait(milliseconds: Int) async -> Bool {
    let deadline = Date().addingTimeInterval(Double(milliseconds) / 1000)
    while Date() < deadline {
      if isSeen {
        return true
      }
      try? await Task.sleep(nanoseconds: 10_000_000)
    }
    return isSeen
  }

  private var isSeen: Bool {
    lock.lock()
    let value = seen
    lock.unlock()
    return value
  }
}
