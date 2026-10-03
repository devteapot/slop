import Foundation
import NIOCore
import NIOHTTP1
import NIOPosix
import NIOWebSocket

public typealias WebSocketUpgradeAuthenticator = (HTTPRequestHead, SocketAddress?) -> Bool

public struct WebSocketProviderOptions {
  public var host: String
  public var port: Int
  public var path: String
  public var discovery: Bool
  public var allowedOrigins: [String]?
  public var authenticate: WebSocketUpgradeAuthenticator?

  public init(
    host: String = "127.0.0.1",
    port: Int = 0,
    path: String = "/slop",
    discovery: Bool = true,
    allowedOrigins: [String]? = nil,
    authenticate: WebSocketUpgradeAuthenticator? = nil
  ) {
    self.host = host
    self.port = port
    self.path = path
    self.discovery = discovery
    self.allowedOrigins = allowedOrigins
    self.authenticate = authenticate
  }
}

public final class WebSocketProviderTransport {
  private let server: SlopServer
  private let options: WebSocketProviderOptions
  private var group: EventLoopGroup?
  private var channel: Channel?
  private var isRunning = false

  public init(server: SlopServer, options: WebSocketProviderOptions = WebSocketProviderOptions()) {
    self.server = server
    self.options = options
  }

  public var url: String? {
    guard let port = channel?.localAddress?.port else { return nil }
    return "ws://\(options.host):\(port)\(options.path)"
  }

  public var port: Int? {
    channel?.localAddress?.port
  }

  public func start() throws {
    guard !isRunning else { return }
    let group = MultiThreadedEventLoopGroup(numberOfThreads: max(1, System.coreCount))
    let bootstrap = ServerBootstrap(group: group)
      .serverChannelOption(ChannelOptions.backlog, value: 256)
      .serverChannelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
      .childChannelInitializer { [server, options] channel in
        let discoveryHandlerName = "SlopWebSocketDiscoveryHTTPHandler"
        let upgradeGuardName = "SlopWebSocketUpgradeGuardHandler"
        let upgrader = NIOWebSocketServerUpgrader(
          maxFrameSize: 1 << 20,
          shouldUpgrade: { channel, _ in
            channel.eventLoop.makeSucceededFuture(HTTPHeaders())
          },
          upgradePipelineHandler: { channel, _ in
            channel.pipeline.removeHandler(name: discoveryHandlerName).flatMap {
              channel.pipeline.removeHandler(name: upgradeGuardName)
            }.flatMap {
              do {
                try channel.pipeline.syncOperations.addHandler(makeWebSocketFrameAggregator())
                return channel.pipeline.addHandler(WebSocketProviderHandler(server: server))
              } catch {
                return channel.eventLoop.makeFailedFuture(error)
              }
            }
          }
        )
        let upgradeConfig = NIOHTTPServerUpgradeConfiguration(
          upgraders: [upgrader],
          completionHandler: { _ in }
        )
        return channel.pipeline.configureHTTPServerPipeline(
          withPipeliningAssistance: false,
          withServerUpgrade: upgradeConfig
        ).flatMap {
          do {
            let upgradeContext = try channel.pipeline.syncOperations.context(handlerType: HTTPServerUpgradeHandler.self)
            try channel.pipeline.syncOperations.addHandler(
              WebSocketUpgradeGuardHandler(
                path: options.path,
                allowedOrigins: options.allowedOrigins,
                authenticate: options.authenticate
              ),
              name: upgradeGuardName,
              position: .before(upgradeContext.handler)
            )
            return channel.eventLoop.makeSucceededVoidFuture()
          } catch {
            return channel.eventLoop.makeFailedFuture(error)
          }
        }.flatMap {
          channel.pipeline.addHandler(WebSocketDiscoveryHTTPHandler(server: server, options: options), name: discoveryHandlerName)
        }
      }
      .childChannelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)

    do {
      channel = try bootstrap.bind(host: options.host, port: options.port).wait()
      self.group = group
      isRunning = true
    } catch {
      try? group.syncShutdownGracefully()
      throw SlopError.internalError("WebSocket provider listen failed: \(error.localizedDescription)")
    }
  }

  public func stop() {
    guard isRunning else { return }
    isRunning = false
    try? channel?.close().wait()
    channel = nil
    try? group?.syncShutdownGracefully()
    group = nil
  }

  deinit {
    stop()
  }
}

public final class NIOWebSocketConnection: SlopConnection {
  private let channel: Channel
  private let lock = NSLock()
  private var messageHandlers: [(SlopMessage) -> Void] = []
  private var closeHandlers: [() -> Void] = []
  private var pendingMessages: [SlopMessage] = []
  private var didClose = false

  init(channel: Channel) {
    self.channel = channel
  }

  public func send(_ message: SlopMessage) {
    do {
      let data = try JSONEncoder().encode(JSONValue.object(message))
      let text = String(decoding: data, as: UTF8.self)
      let buffer = channel.allocator.buffer(string: text)
      let frame = WebSocketFrame(fin: true, opcode: .text, data: buffer)
      channel.writeAndFlush(frame, promise: nil)
    } catch {
      fireClose()
    }
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
    lock.lock()
    let alreadyClosed = didClose
    lock.unlock()
    guard !alreadyClosed else { return }

    let buffer = channel.allocator.buffer(capacity: 0)
    let frame = WebSocketFrame(fin: true, opcode: .connectionClose, data: buffer)
    channel.writeAndFlush(frame, promise: nil)
    channel.close(promise: nil)
    fireClose()
  }

  func receive(_ message: SlopMessage) {
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

  func fireClose() {
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

final class WebSocketProviderHandler: ChannelDuplexHandler {
  typealias InboundIn = WebSocketFrame
  typealias OutboundIn = WebSocketFrame
  typealias OutboundOut = WebSocketFrame

  private weak var server: SlopServer?
  private var connection: NIOWebSocketConnection?

  init(server: SlopServer) {
    self.server = server
  }

  func handlerAdded(context: ChannelHandlerContext) {
    let connection = NIOWebSocketConnection(channel: context.channel)
    self.connection = connection
    server?.attachConnection(connection)
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
      connection?.receive(message)
    case .binary:
      var payload = frame.unmaskedData
      guard
        let bytes = payload.readBytes(length: payload.readableBytes),
        case .object(let message) = try? JSONDecoder().decode(JSONValue.self, from: Data(bytes))
      else {
        return
      }
      connection?.receive(message)
    case .connectionClose:
      connection?.fireClose()
      context.close(promise: nil)
    default:
      break
    }
  }

  func channelInactive(context: ChannelHandlerContext) {
    if let connection {
      server?.handleDisconnect(connection)
      connection.fireClose()
    }
  }
}

final class WebSocketUpgradeGuardHandler: ChannelInboundHandler, RemovableChannelHandler {
  typealias InboundIn = HTTPServerRequestPart
  typealias OutboundOut = HTTPServerResponsePart

  private let path: String
  private let allowedOrigins: [String]?
  private let authenticate: WebSocketUpgradeAuthenticator?
  private var rejecting = false

  init(
    path: String,
    allowedOrigins: [String]?,
    authenticate: WebSocketUpgradeAuthenticator?
  ) {
    self.path = path
    self.allowedOrigins = allowedOrigins
    self.authenticate = authenticate
  }

  func channelRead(context: ChannelHandlerContext, data: NIOAny) {
    let part = unwrapInboundIn(data)
    switch part {
    case .head(let head):
      let isWebSocketUpgrade = head.headers.first(name: "Upgrade")?.lowercased() == "websocket"
      if isWebSocketUpgrade,
         !isAllowedWebSocketUpgrade(
           head,
           remoteAddress: context.channel.remoteAddress,
           path: path,
           allowedOrigins: allowedOrigins,
           authenticate: authenticate
         ) {
        rejecting = true
        let status: HTTPResponseStatus = requestPath(head.uri) == path ? .forbidden : .notFound
        sendResponse(status: status, context: context)
        return
      }
      context.fireChannelRead(data)
    case .body, .end:
      if !rejecting {
        context.fireChannelRead(data)
      }
    }
  }

  private func sendResponse(status: HTTPResponseStatus, context: ChannelHandlerContext) {
    let body = status == .forbidden ? "Forbidden" : "Not Found"
    let buffer = context.channel.allocator.buffer(string: body)
    var headers = HTTPHeaders()
    headers.add(name: "Content-Type", value: "text/plain; charset=utf-8")
    headers.add(name: "Content-Length", value: "\(buffer.readableBytes)")
    headers.add(name: "Connection", value: "close")
    let head = HTTPResponseHead(version: .http1_1, status: status, headers: headers)
    context.write(wrapOutboundOut(.head(head)), promise: nil)
    context.write(wrapOutboundOut(.body(.byteBuffer(buffer))), promise: nil)
    context.writeAndFlush(wrapOutboundOut(.end(nil))).whenComplete { _ in
      context.close(promise: nil)
    }
  }
}

private final class WebSocketDiscoveryHTTPHandler: ChannelInboundHandler, RemovableChannelHandler {
  typealias InboundIn = HTTPServerRequestPart
  typealias OutboundOut = HTTPServerResponsePart

  private weak var server: SlopServer?
  private let options: WebSocketProviderOptions
  private var head: HTTPRequestHead?

  init(server: SlopServer, options: WebSocketProviderOptions) {
    self.server = server
    self.options = options
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
      if options.discovery, requestPath(head.uri) == "/.well-known/slop", let server {
        let host = head.headers.first(name: "Host") ?? "\(options.host):\(context.channel.localAddress?.port ?? options.port)"
        let descriptor = ProviderDescriptor(
          id: server.id,
          name: server.name,
          slopVersion: "0.1",
          transport: ProviderTransport(type: .ws, url: "ws://\(host)\(options.path)"),
          pid: Int(ProcessInfo.processInfo.processIdentifier),
          capabilities: ["state", "patches", "affordances", "attention", "windowing", "async", "content_refs"]
        )
        let body = (try? JSONEncoder().encode(descriptor)) ?? Data()
        sendResponse(status: .ok, body: body, contentType: "application/json", context: context)
      } else if requestPath(head.uri) == options.path, head.headers.first(name: "Upgrade")?.lowercased() == "websocket" {
        sendResponse(status: .forbidden, body: "Forbidden", context: context)
      } else {
        sendResponse(status: .notFound, body: "Not Found", context: context)
      }
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
    sendResponse(status: status, body: Data(body.utf8), contentType: "text/plain; charset=utf-8", context: context)
  }

  private func sendResponse(status: HTTPResponseStatus, body: Data, contentType: String, context: ChannelHandlerContext) {
    var buffer = context.channel.allocator.buffer(capacity: body.count)
    buffer.writeBytes(body)

    var headers = HTTPHeaders()
    headers.add(name: "Content-Type", value: contentType)
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

func makeWebSocketFrameAggregator() -> NIOWebSocketFrameAggregator {
  NIOWebSocketFrameAggregator(
    minNonFinalFragmentSize: 1,
    maxAccumulatedFrameCount: 128,
    maxAccumulatedFrameSize: 1 << 20
  )
}

extension SlopServer {
  @discardableResult
  public func listenWebSocket(options: WebSocketProviderOptions = WebSocketProviderOptions()) throws -> WebSocketProviderTransport {
    let transport = WebSocketProviderTransport(server: self, options: options)
    try transport.start()
    return transport
  }
}

func isAllowedWebSocketUpgrade(
  _ head: HTTPRequestHead,
  remoteAddress: SocketAddress?,
  path: String,
  allowedOrigins: [String]?,
  authenticate: WebSocketUpgradeAuthenticator?
) -> Bool {
  guard requestPath(head.uri) == path else {
    return false
  }

  if let origin = head.headers.first(name: "Origin") {
    guard let allowedOrigins, allowedOrigins.contains(origin) else {
      return false
    }
  }

  if let authenticate {
    return authenticate(head, remoteAddress)
  }

  return isLoopback(remoteAddress)
}

private func isLoopback(_ address: SocketAddress?) -> Bool {
  guard let ipAddress = address?.ipAddress else { return false }
  return ipAddress == "127.0.0.1"
    || ipAddress == "::1"
    || ipAddress == "0:0:0:0:0:0:0:1"
    || ipAddress == "::ffff:127.0.0.1"
}

func requestPath(_ uri: String) -> String {
  if let components = URLComponents(string: uri), !components.path.isEmpty {
    return components.path
  }
  return String(uri.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first ?? "/")
}
