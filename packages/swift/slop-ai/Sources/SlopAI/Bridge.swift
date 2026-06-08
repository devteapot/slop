import Foundation
import NIOCore
import NIOHTTP1
import NIOPosix
import NIOWebSocket

public let defaultBridgeURL = "ws://127.0.0.1:9339/slop-bridge"
public let defaultBridgeHost = "127.0.0.1"
public let defaultBridgePort = 9339
public let defaultBridgePath = "/slop-bridge"

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
    var connection: BridgeRelayConnection!
    let unsubscribe = bridge.subscribeRelay(providerKey: providerKey) { message in
      responseFlag.mark()
      connection?.receive(message)
    }
    connection = BridgeRelayConnection(bridge: bridge, providerKey: providerKey, unsubscribe: unsubscribe)

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

  init(bridge: DiscoveryBridge, providerKey: String, unsubscribe: @escaping () -> Void) {
    self.bridge = bridge
    self.providerKey = providerKey
    self.unsubscribe = unsubscribe
  }

  public func send(_ message: SlopMessage) {
    lock.lock()
    let closed = closed
    lock.unlock()
    guard !closed else { return }

    Task { [bridge, providerKey] in
      try? await bridge.send([
        "type": "slop-relay",
        "providerKey": .string(providerKey),
        "message": .object(message),
      ])
    }
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
    closeHandlers.append(handler)
    lock.unlock()
  }

  public func close() {
    lock.lock()
    guard !closed else {
      lock.unlock()
      return
    }
    closed = true
    let handlers = closeHandlers
    closeHandlers.removeAll()
    lock.unlock()

    Task { [bridge, providerKey] in
      try? await bridge.send(["type": "relay-close", "providerKey": .string(providerKey)])
    }
    unsubscribe()
    for handler in handlers {
      handler()
    }
  }

  func receive(_ message: SlopMessage) {
    lock.lock()
    if buffering {
      earlyMessages.append(message)
    }
    let handlers = messageHandlers
    lock.unlock()

    for handler in handlers {
      handler(message)
    }
  }
}

public final class BridgeClient: DiscoveryBridge {
  private let url: URL
  private let reconnectDelayNanoseconds: UInt64
  private let lock = NSLock()
  private var connection: SlopConnection?
  private var providerMap: [String: BridgeProvider] = [:]
  private var relaySubscribers: [String: [UUID: BridgeRelayHandler]] = [:]
  private var changeCallbacks: [UUID: () -> Void] = [:]
  private var started = false
  private var reconnectTask: Task<Void, Never>?

  public init(url: URL = URL(string: defaultBridgeURL)!, reconnectDelay: TimeInterval = 5.0) {
    self.url = url
    reconnectDelayNanoseconds = UInt64(max(0, reconnectDelay) * 1_000_000_000)
  }

  public var running: Bool {
    locked { connection != nil }
  }

  public func connectOnce() async throws {
    if locked({ self.connection != nil }) {
      return
    }

    let transport = URLSessionWebSocketTransport(url: url)
    let connection = try await transport.connect()
    connection.onMessage { [weak self] message in
      self?.handleBridgeMessage(message)
    }
    connection.onClose { [weak self, weak connection] in
      guard let self else { return }
      self.handleDisconnect(connection)
    }

    locked {
      self.connection = connection
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
    started = false
    reconnectTask?.cancel()
    reconnectTask = nil
    let connection = connection
    self.connection = nil
    let changed = !providerMap.isEmpty
    providerMap.removeAll()
    relaySubscribers.removeAll()
    let callbacks = Array(changeCallbacks.values)
    lock.unlock()

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
          self.locked {
            self.reconnectTask = nil
          }
          return
        } catch {
          try? await Task.sleep(nanoseconds: self.reconnectDelayNanoseconds)
        }
      }
    }
    lock.unlock()
  }

  private func handleBridgeMessage(_ message: SlopMessage) {
    switch message["type"]?.stringValue {
    case "provider-available":
      guard let provider = parseBridgeProvider(message) else { return }
      let callbacks = lockedChange {
        providerMap[provider.providerKey] = provider
      }
      for callback in callbacks {
        callback()
      }
    case "provider-unavailable":
      guard let providerKey = message["providerKey"]?.stringValue, !providerKey.isEmpty else { return }
      let callbacks = lockedChange {
        providerMap.removeValue(forKey: providerKey)
        relaySubscribers.removeValue(forKey: providerKey)
      }
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
    default:
      break
    }
  }

  private func handleDisconnect(_ connection: SlopConnection?) {
    lock.lock()
    if let connection, let current = self.connection, ObjectIdentifier(connection) != ObjectIdentifier(current) {
      lock.unlock()
      return
    }
    self.connection = nil
    let changed = !providerMap.isEmpty
    providerMap.removeAll()
    relaySubscribers.removeAll()
    let callbacks = Array(changeCallbacks.values)
    let shouldReconnect = started
    lock.unlock()

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
  private let state = BridgeServerState()
  private var group: EventLoopGroup?
  private var channel: Channel?

  public init(host: String = defaultBridgeHost, port: Int = defaultBridgePort, path: String = defaultBridgePath) {
    self.host = host
    listenPort = port
    self.path = path
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
      .childChannelInitializer { [state, path] channel in
        let upgrader = NIOWebSocketServerUpgrader(
          maxFrameSize: 1 << 20,
          shouldUpgrade: { channel, head in
            guard requestPath(head.uri) == path else {
              return channel.eventLoop.makeSucceededFuture(nil)
            }
            return channel.eventLoop.makeSucceededFuture(HTTPHeaders())
          },
          upgradePipelineHandler: { channel, _ in
            channel.pipeline.addHandler(BridgeServerWebSocketHandler(state: state))
          }
        )
        let upgradeConfig = NIOHTTPServerUpgradeConfiguration(upgraders: [upgrader], completionHandler: { _ in })
        return channel.pipeline.configureHTTPServerPipeline(withServerUpgrade: upgradeConfig)
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
  public func subscribeRelay(providerKey: String, handler: @escaping BridgeRelayHandler) -> () -> Void {
    state.subscribeRelay(providerKey: providerKey, handler: handler)
  }

  public func send(_ message: SlopMessage) async throws {
    state.broadcast(message)
  }
}

private final class BridgeServerWebSocketHandler: ChannelInboundHandler {
  typealias InboundIn = WebSocketFrame

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
    case .text:
      var payload = frame.unmaskedData
      guard
        let text = payload.readString(length: payload.readableBytes),
        let data = text.data(using: .utf8),
        case .object(let message) = try? JSONDecoder().decode(JSONValue.self, from: data)
      else {
        return
      }
      state.handle(message)
    case .binary:
      var payload = frame.unmaskedData
      guard
        let bytes = payload.readBytes(length: payload.readableBytes),
        case .object(let message) = try? JSONDecoder().decode(JSONValue.self, from: Data(bytes))
      else {
        return
      }
      state.handle(message)
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

private final class BridgeServerState {
  private let lock = NSLock()
  private var sinkMap: [ObjectIdentifier: SlopConnection] = [:]
  private var providerMap: [String: BridgeProvider] = [:]
  private var relaySubscribers: [String: [UUID: BridgeRelayHandler]] = [:]
  private var changeCallbacks: [UUID: () -> Void] = [:]
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
    lock.lock()
    sinkMap.removeValue(forKey: ObjectIdentifier(sink))
    let hadProviders = !providerMap.isEmpty
    if sinkMap.isEmpty {
      providerMap.removeAll()
      relaySubscribers.removeAll()
    }
    callbacks = hadProviders && sinkMap.isEmpty ? Array(changeCallbacks.values) : []
    lock.unlock()

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

  func handle(_ message: SlopMessage) {
    switch message["type"]?.stringValue {
    case "provider-available":
      guard let provider = parseBridgeProvider(message) else { return }
      let callbacks = lockedChange {
        providerMap[provider.providerKey] = provider
      }
      broadcast(message)
      for callback in callbacks {
        callback()
      }
    case "provider-unavailable":
      guard let providerKey = message["providerKey"]?.stringValue, !providerKey.isEmpty else { return }
      let callbacks = lockedChange {
        providerMap.removeValue(forKey: providerKey)
        relaySubscribers.removeValue(forKey: providerKey)
      }
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
    lock.lock()
    let changed = !providerMap.isEmpty
    providerMap.removeAll()
    relaySubscribers.removeAll()
    sinkMap.removeAll()
    callbacks = changed ? Array(changeCallbacks.values) : []
    lock.unlock()

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
