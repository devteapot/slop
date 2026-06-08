import XCTest
@testable import SlopAI

#if canImport(Darwin)
import Darwin
#endif

final class SlopAITests: XCTestCase {
  func testDescriptorNormalizationExtractsHandlersAndWireShape() async throws {
    let descriptor = NodeDescriptor(
      type: "collection",
      props: ["count": 1],
      summary: "Open todos",
      items: [
        ItemDescriptor(id: "first", props: ["title": "Ship Swift"], summary: "Top priority")
      ],
      children: [
        "stats": NodeDescriptor(type: "panel", props: ["done": 0])
      ],
      actions: [
        "add": .value(params: ["title": .type("string")], label: "Add todo") { params in
          .object(["title": params["title"] ?? .null])
        }
      ]
    )

    let result = try normalizeDescriptor(path: "todos", id: "todos", descriptor: descriptor)

    XCTAssertEqual(result.node.id, "todos")
    XCTAssertEqual(result.node.type, "collection")
    XCTAssertEqual(result.node.properties?["count"], 1)
    XCTAssertEqual(result.node.meta?.summary, "Open todos")
    XCTAssertEqual(result.node.children?.map(\.id), ["first", "stats"])
    XCTAssertEqual(result.node.affordances?.first?.action, "add")
    XCTAssertEqual(result.node.affordances?.first?.params?.required, ["title"])
    XCTAssertNotNil(result.handlers["todos/add"])
  }

  func testTreeAssemblyCreatesSyntheticAncestorsAndMergesRealNodes() throws {
    let result = try assembleTree(
      registrations: [
        "inbox/messages": NodeDescriptor(type: "collection", props: ["count": 2]),
        "inbox": NodeDescriptor(type: "panel", props: ["label": "Inbox"]),
      ],
      rootID: "app",
      rootName: "Mail"
    )

    let inbox = try XCTUnwrap(result.tree.children?.first)
    XCTAssertEqual(inbox.id, "inbox")
    XCTAssertEqual(inbox.type, "panel")
    XCTAssertEqual(inbox.children?.first?.id, "messages")
    XCTAssertEqual(inbox.children?.first?.properties?["count"], 2)
  }

  func testDiffOpsApplyThroughStateMirror() throws {
    let old = SlopNode(
      id: "root",
      type: "root",
      children: [
        SlopNode(id: "a", type: "item", properties: ["title": "A"]),
        SlopNode(id: "b", type: "item", properties: ["title": "B"]),
      ]
    )
    let new = SlopNode(
      id: "root",
      type: "root",
      children: [
        SlopNode(id: "b", type: "item", properties: ["title": "B"]),
        SlopNode(id: "a", type: "item", properties: ["title": "A+"] ),
        SlopNode(id: "c", type: "item", properties: ["title": "C"]),
      ]
    )

    let ops = diffNodes(old, new)
    XCTAssertTrue(ops.contains { $0.op == .add && $0.path == "/c" && $0.index == 2 })
    XCTAssertTrue(ops.contains { $0.op == .move && $0.path == "/b" && $0.index == 0 })
    XCTAssertTrue(ops.contains { $0.op == .replace && $0.path == "/a/properties/title" })

    let mirror = StateMirror(snapshot: SnapshotMessage(id: "sub-1", version: 1, seq: 0, tree: old))
    try mirror.applyPatch(PatchMessage(subscription: "sub-1", version: 2, seq: 1, ops: ops))
    XCTAssertEqual(mirror.getTree(), new)
    XCTAssertEqual(mirror.getVersion(), 2)
    XCTAssertThrowsError(try mirror.applyPatch(PatchMessage(subscription: "sub-1", version: 3, seq: 3, ops: [])))
  }

  func testValidateParamsMatchesSchemaSubset() {
    let schema = normalizeParams([
      "title": .type("string"),
      "priority": .schema(JSONSchema(type: "integer", enumValues: [1, 2, 3])),
    ])

    XCTAssertNil(validateParams(schema: schema, params: .object(["title": "Write", "priority": 2])))
    XCTAssertEqual(validateParams(schema: schema, params: .object(["priority": 2])), "params.title is required")
    XCTAssertEqual(validateParams(schema: schema, params: .object(["title": "Write", "priority": 4])), "params.priority must be one of [1,2,3]")
  }

  func testScalingFormatsAndGroupsAffordances() {
    let params = normalizeParams(["title": .type("string")])
    let root = SlopNode(
      id: "app",
      type: "root",
      children: [
        SlopNode(id: "card-1", type: "card", affordances: [Affordance(action: "edit", params: params)]),
        SlopNode(id: "card-2", type: "card", affordances: [Affordance(action: "edit", params: params)]),
      ]
    )

    let tools = affordancesToTools(root)
    XCTAssertEqual(tools.tools.count, 1)
    XCTAssertEqual(tools.tools.first?.function.name, "edit")
    XCTAssertEqual(tools.resolve("edit")?.path, nil)
    XCTAssertEqual(tools.resolve("edit")?.targets, ["/card-1", "/card-2"])

    let truncated = truncateTree(root, depth: 0)
    XCTAssertNil(truncated.children)
    XCTAssertEqual(truncated.meta?.totalChildren, 2)
    XCTAssertTrue(formatTree(root).contains("[card] card-1"))
  }

  func testServerSubscribeInvokeAndPatchBroadcast() async throws {
    let server = SlopServer(id: "todos", name: "Todos")
    try server.register(
      "list",
      descriptor: NodeDescriptor(
        type: "collection",
        props: ["count": 1],
        actions: [
          "add": .value(params: ["title": .type("string")]) { params in
            .object(["created": params["title"] ?? .null])
          }
        ]
      )
    )

    let connection = RecordingConnection()
    server.handleConnection(connection)
    XCTAssertEqual(connection.messages.first?["type"], "hello")

    await server.handleMessage(["type": "subscribe", "id": "sub-1", "path": "/list", "depth": 1], from: connection)
    XCTAssertEqual(connection.messages.last?["type"], "snapshot")
    XCTAssertEqual(connection.messages.last?["seq"], 0)

    await server.handleMessage(["type": "invoke", "id": "bad", "path": "/list", "action": "add", "params": [:]], from: connection)
    XCTAssertEqual(connection.messages.last?["status"], "error")
    XCTAssertEqual(connection.messages.last?["error"]?.objectValue?["code"], "invalid_params")

    await server.handleMessage(["type": "invoke", "id": "ok", "path": "/list", "action": "add", "params": ["title": "New"]], from: connection)
    XCTAssertEqual(connection.messages.last?["status"], "ok")
    XCTAssertEqual(connection.messages.last?["data"]?.objectValue?["created"], "New")

    try server.register("list", descriptor: NodeDescriptor(type: "collection", props: ["count": 2]))
    XCTAssertEqual(connection.messages.last?["type"], "patch")
    XCTAssertEqual(connection.messages.last?["subscription"], "sub-1")
  }

  func testConsumerConnectWiresIncomingConnectionMessages() async throws {
    let connection = InMemoryConnection { _ in }
    let consumer = SlopConsumer(transport: InMemoryTransport(connection: connection))

    let helloTask = Task { try await consumer.connect() }
    await connection.waitForMessageHandler()
    connection.receive([
      "type": "hello",
      "provider": .object(["id": "app", "name": "App", "slop_version": "0.1", "capabilities": []]),
    ])

    let message = try await helloTask.value
    XCTAssertEqual(message["type"], "hello")

    let snapshot = SlopNode(id: "app", type: "root")
    connection.receive(snapshotMessage(id: "sub-1", version: 1, seq: 0, tree: snapshot))
    XCTAssertEqual(consumer.getTree(subscriptionID: "sub-1"), snapshot)
  }

  func testConsumerCallbacksCanUnsubscribeAndDisconnectFires() async throws {
    let connection = InMemoryConnection { _ in }
    let consumer = SlopConsumer(transport: InMemoryTransport(connection: connection))
    var events: [String] = []
    let unsubscribe = consumer.onEvent { name, _ in events.append(name) }
    var disconnects = 0
    consumer.onDisconnect { disconnects += 1 }

    let helloTask = Task { try await consumer.connect() }
    await connection.waitForMessageHandler()
    connection.receive([
      "type": "hello",
      "provider": .object(["id": "app", "name": "App", "slop_version": "0.1", "capabilities": []]),
    ])
    _ = try await helloTask.value

    connection.receive(["type": "event", "name": "ready"])
    unsubscribe()
    connection.receive(["type": "event", "name": "ignored"])
    connection.close()

    XCTAssertEqual(events, ["ready"])
    XCTAssertEqual(disconnects, 1)
  }

  func testConsumerSubscribeQueryAndInvokeThroughTransport() async throws {
    let sent = MessageList()
    var connection: InMemoryConnection!
    connection = InMemoryConnection { message in
      sent.append(message)
      guard let type = message["type"]?.stringValue, let id = message["id"]?.stringValue else { return }
      switch type {
      case "subscribe", "query":
        connection.receive(
          snapshotMessage(
            id: id,
            version: 1,
            seq: type == "subscribe" ? 0 : nil,
            tree: SlopNode(id: "app", type: "root", children: [SlopNode(id: "panel", type: "view")])
          )
        )
      case "invoke":
        connection.receive([
          "type": "result",
          "id": .string(id),
          "status": "ok",
          "data": .object(["pressed": true]),
        ])
      default:
        break
      }
    }

    let consumer = SlopConsumer(transport: InMemoryTransport(connection: connection))
    let helloTask = Task { try await consumer.connect() }
    await connection.waitForMessageHandler()
    connection.receive([
      "type": "hello",
      "provider": .object(["id": "app", "name": "App", "slop_version": "0.1", "capabilities": []]),
    ])
    _ = try await helloTask.value

    let subscription = try await consumer.subscribe(path: "/", depth: -1)
    XCTAssertEqual(subscription.snapshot.children?.first?.id, "panel")
    XCTAssertEqual(consumer.getTree(subscriptionID: subscription.id)?.id, "app")

    let queried = try await consumer.query(path: "/", depth: 1)
    XCTAssertEqual(queried.children?.first?.type, "view")

    let result = try await consumer.invoke(path: "/panel", action: "press")
    XCTAssertEqual(result["status"], "ok")
    XCTAssertEqual(result["data"]?.objectValue?["pressed"], true)

    XCTAssertEqual(sent.values().map { $0["type"]?.stringValue }, ["subscribe", "query", "invoke"])
  }

  func testHelpersPickOmitAndAction() async throws {
    let object: [String: JSONValue] = ["a": 1, "b": 2, "c": "three"]
    XCTAssertEqual(pick(object, keys: ["a", "c"]), ["a": 1, "c": "three"])
    XCTAssertEqual(omit(object, keys: ["b"]), ["a": 1, "c": "three"])

    let add = action(params: ["title": .type("string")], label: "Add") { params in
      .object(["title": params["title"] ?? .null])
    }
    XCTAssertEqual(add.label, "Add")
    XCTAssertEqual(add.params, ["title": .type("string")])
    let result = try await add.handler(["title": "Swift"])
    XCTAssertEqual(result, .value(.object(["title": "Swift"])))
  }

  func testAsyncActionRegistersTaskAndReturnsAccepted() async throws {
    let server = SlopServer(id: "app", name: "App")
    let action = server.asyncAction(params: ["name": .type("string")], label: "Run") { params, task in
      task.update(progress: 0.5, message: "Halfway")
      return .object(["name": params["name"] ?? .null])
    }
    try server.register("runner", descriptor: NodeDescriptor(type: "control", actions: ["run": action]))

    let result = await server.executeInvoke(id: "inv-1", path: "/runner", action: "run", params: ["name": "job"])
    XCTAssertEqual(result["status"], "accepted")
    let taskID = try XCTUnwrap(result["data"]?.objectValue?["taskId"]?.stringValue)
    XCTAssertNotNil(getSubtree(server.tree, path: "/tasks/\(taskID)"))
  }

  func testDiscoveryRegisterAndReadProvider() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }

    try Discovery.registerProvider(
      id: "swift-app",
      name: "Swift App",
      transport: ProviderTransport(type: .ws, url: "ws://127.0.0.1:7777/slop"),
      directory: directory,
      pid: 123
    )

    let descriptors = Discovery.readDescriptors(from: [directory])
    XCTAssertEqual(descriptors.count, 1)
    XCTAssertEqual(descriptors.first?.id, "swift-app")
    XCTAssertEqual(descriptors.first?.transport.type, .ws)

    Discovery.unregisterProvider(id: "swift-app", directory: directory)
    XCTAssertTrue(Discovery.readDescriptors(from: [directory]).isEmpty)
  }

  #if canImport(Darwin)
  func testDiscoveryDefaultFactorySupportsUnixDescriptorsOnDarwin() {
    let descriptor = ProviderDescriptor(
      id: "mac-app",
      name: "Mac App",
      slopVersion: "0.1",
      transport: ProviderTransport(type: .unix, path: "/tmp/slop/mac-app.sock"),
      capabilities: []
    )

    XCTAssertTrue(Discovery.defaultTransportFactory(descriptor) is UnixSocketClientTransport)
  }
  #endif

  func testDiscoveryServiceConnectsWithInjectedTransport() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    try Discovery.registerProvider(
      id: "memory-app",
      name: "Memory App",
      transport: ProviderTransport(type: .ws, url: "ws://memory/slop"),
      directory: directory,
      pid: 123
    )

    var connection: InMemoryConnection!
    connection = InMemoryConnection { message in
      if message["type"] == "subscribe", let id = message["id"]?.stringValue {
        let tree = SlopNode(
          id: "memory-app",
          type: "root",
          children: [
            SlopNode(id: "button", type: "control", affordances: [Affordance(action: "press")])
          ]
        )
        connection.receive(snapshotMessage(id: id, version: 1, seq: 0, tree: tree))
      }
    }

    let service = DiscoveryService(
      options: DiscoveryOptions(providerDirectories: [directory]) { _ in
        InMemoryTransport(connection: connection)
      }
    )
    let connectTask = Task { try await service.ensureConnected("memory-app") }
    await connection.waitForMessageHandler()
    connection.receive([
      "type": "hello",
      "provider": .object(["id": "memory-app", "name": "Memory App", "slop_version": "0.1", "capabilities": []]),
    ])
    let connectedProvider = try await connectTask.value
    let provider = try XCTUnwrap(connectedProvider)

    XCTAssertEqual(provider.id, "memory-app")
    XCTAssertEqual(service.getProviders().count, 1)
    let dynamic = createDynamicTools(providers: service.getProviders())
    XCTAssertEqual(dynamic.tools.first?.name, "memory_app__button__press")
    XCTAssertTrue(service.disconnect("Memory App"))
  }

  func testServerSupportsConcurrentRegistrationAndReads() async throws {
    let server = SlopServer(id: "concurrent", name: "Concurrent")

    try await withThrowingTaskGroup(of: Void.self) { group in
      for index in 0..<50 {
        group.addTask {
          try server.register(
            "items/\(index)",
            descriptor: NodeDescriptor(type: "item", props: ["index": .number(Double(index))])
          )
          _ = try server.outputTree(OutputRequest(path: "/", depth: 2))
        }
      }
      try await group.waitForAll()
    }

    let tree = try server.outputTree(OutputRequest(path: "/", depth: -1))
    XCTAssertEqual(tree.children?.first { $0.id == "items" }?.children?.count, 50)
  }

  func testStdioProviderTransportSpeaksNDJSON() async throws {
    let server = SlopServer(id: "stdio-app", name: "Stdio App")
    try server.register("status", descriptor: NodeDescriptor(type: "status", props: ["ready": true]))

    let input = Pipe()
    let output = Pipe()
    let reader = PipeJSONReader(output.fileHandleForReading)
    let transport = server.listenStdio(input: input.fileHandleForReading, output: output.fileHandleForWriting)
    defer {
      transport.stop()
      try? input.fileHandleForWriting.close()
      try? output.fileHandleForReading.close()
    }

    let hello = try XCTUnwrap(reader.next())
    XCTAssertEqual(hello["type"], "hello")
    XCTAssertEqual(hello["provider"]?.objectValue?["id"], "stdio-app")

    writePipeJSON(
      input.fileHandleForWriting,
      ["type": "query", "id": "q-stdio", "path": "/", "depth": 1]
    )
    let snapshot = try XCTUnwrap(reader.next())
    XCTAssertEqual(snapshot["type"], "snapshot")
    XCTAssertEqual(snapshot["id"], "q-stdio")
    XCTAssertEqual(snapshot["tree"]?.objectValue?["id"], "stdio-app")
  }

  func testWebSocketProviderTransportServesConsumerAndDiscovery() async throws {
    let server = SlopServer(id: "ws-provider", name: "WS Provider")
    try server.register(
      "status",
      descriptor: NodeDescriptor(
        type: "status",
        props: ["online": true],
        actions: ["ping": .value { _ in .object(["pong": true]) }]
      )
    )

    let transport = try server.listenWebSocket(
      options: WebSocketProviderOptions(host: "127.0.0.1", port: 0, path: "/slop")
    )
    defer { transport.stop() }

    let url = try XCTUnwrap(transport.url.flatMap(URL.init(string:)))
    let discoveryURL = URL(string: "http://127.0.0.1:\(try XCTUnwrap(transport.port))/.well-known/slop")!
    let (data, _) = try await URLSession.shared.data(from: discoveryURL)
    let descriptor = try JSONDecoder().decode(ProviderDescriptor.self, from: data)
    XCTAssertEqual(descriptor.id, "ws-provider")
    XCTAssertEqual(descriptor.transport.type, .ws)

    let consumer = SlopConsumer(transport: URLSessionWebSocketTransport(url: url))
    let hello = try await consumer.connect()
    XCTAssertEqual(hello["provider"]?.objectValue?["id"], "ws-provider")

    let queried = try await consumer.query(path: "/status", depth: 1)
    XCTAssertEqual(queried.properties?["online"], true)

    let result = try await consumer.invoke(path: "/status", action: "ping")
    XCTAssertEqual(result["status"], "ok")
    XCTAssertEqual(result["data"]?.objectValue?["pong"], true)
  }

  func testDiscoveryRejectsInsecureLocalDescriptors() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }

    try Discovery.registerProvider(
      id: "secure-app",
      name: "Secure App",
      transport: ProviderTransport(type: .ws, url: "ws://127.0.0.1/slop"),
      directory: directory
    )
    XCTAssertEqual(Discovery.readDescriptors(from: [directory]).count, 1)

    let descriptorFile = directory.appendingPathComponent("secure-app.json")
    try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: descriptorFile.path)
    XCTAssertTrue(Discovery.readDescriptors(from: [directory]).isEmpty)

    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: descriptorFile.path)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: directory.path)
    XCTAssertTrue(Discovery.readDescriptors(from: [directory]).isEmpty)
  }

  func testBridgeRelayTransportAndDiscoveryService() async throws {
    let bridge = FakeBridge()
    let service = DiscoveryService(
      options: DiscoveryOptions(providerDirectories: [], bridges: [bridge])
    )

    let discovered = service.getDiscovered()
    XCTAssertEqual(discovered.first?.id, "tab-1")
    XCTAssertEqual(discovered.first?.transport.type, .relay)

    let connected = try await service.ensureConnected("tab-1")
    let provider = try XCTUnwrap(connected)
    XCTAssertEqual(provider.id, "tab-1")
    XCTAssertEqual(provider.consumer.getTree(subscriptionID: provider.subscriptionID)?.id, "tab-1")
    XCTAssertTrue(bridge.sentTypes().contains("relay-open"))
    XCTAssertTrue(bridge.sentTypes().contains("slop-relay"))
  }

  func testBridgeServerTracksProvidersAndDispatchesRelay() async throws {
    let bridge = BridgeServer(port: 0)
    try bridge.start()
    defer { bridge.stop() }

    let url = try XCTUnwrap(bridge.url.flatMap(URL.init(string:)))
    let connection = try await URLSessionWebSocketTransport(url: url).connect()
    defer { connection.close() }

    connection.send([
      "type": "provider-available",
      "tabId": 7,
      "providerKey": "tab-bridge",
      "provider": .object(["id": "app", "name": "App", "transport": "postmessage"]),
    ])
    try await waitUntil {
      bridge.providers().first?.providerKey == "tab-bridge"
    }

    let relay = MessageBox()
    let unsubscribe = bridge.subscribeRelay(providerKey: "tab-bridge") { message in
      relay.set(message)
    }
    defer { unsubscribe() }

    connection.send([
      "type": "slop-relay",
      "providerKey": "tab-bridge",
      "message": .object(["type": "hello"]),
    ])
    try await waitUntil {
      relay.value()?["type"] == "hello"
    }
  }

  #if canImport(Darwin)
  func testUnixSocketClientTransportConnectsOverNDJSON() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let socketPath = directory.appendingPathComponent("slop.sock").path
    let listener = try makeUnixListener(path: socketPath)
    defer {
      Darwin.close(listener)
      Darwin.unlink(socketPath)
    }

    let received = MessageBox()
    DispatchQueue.global(qos: .utility).async {
      let fd = Darwin.accept(listener, nil, nil)
      guard fd >= 0 else { return }
      defer { Darwin.close(fd) }
      setReadTimeout(fd, seconds: 5)

      writeUnixJSON(
        fd,
        [
          "type": "hello",
          "provider": .object([
            "id": "mac-app",
            "name": "Mac App",
            "slop_version": "0.1",
            "capabilities": [],
          ]),
        ]
      )

      guard let query = readUnixJSON(fd) else { return }
      received.set(query)
      let id = query["id"]?.stringValue ?? "q-1"
      writeUnixJSON(
        fd,
        snapshotMessage(
          id: id,
          version: 1,
          tree: SlopNode(id: "mac-app", type: "root", children: [SlopNode(id: "window", type: "view")])
        )
      )
    }

    let consumer = SlopConsumer(transport: UnixSocketClientTransport(path: socketPath))
    let hello = try await consumer.connect()
    XCTAssertEqual(hello["type"], "hello")
    XCTAssertEqual(hello["provider"]?.objectValue?["id"], "mac-app")

    let tree = try await consumer.query(path: "/", depth: 1)
    XCTAssertEqual(tree.id, "mac-app")
    XCTAssertEqual(tree.children?.first?.id, "window")
    XCTAssertEqual(received.value()?["type"], "query")
  }

  func testSwiftAppCanActAsProviderOverUnixSocketAndDiscovery() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let socketPath = directory.appendingPathComponent("provider.sock").path
    let discoveryDirectory = directory.appendingPathComponent("providers")

    let server = SlopServer(id: "swift-provider", name: "Swift Provider")
    try server.register(
      "status",
      descriptor: NodeDescriptor(
        type: "status",
        props: ["healthy": true],
        actions: [
          "ping": .value { _ in
            .object(["pong": true])
          }
        ]
      )
    )

    let listener = try server.listenUnix(path: socketPath, discover: true, discoveryDirectory: discoveryDirectory)
    defer { listener.stop() }

    let descriptor = try XCTUnwrap(Discovery.readDescriptors(from: [discoveryDirectory]).first)
    XCTAssertEqual(descriptor.id, "swift-provider")
    XCTAssertEqual(descriptor.transport.type, .unix)

    let consumer = try XCTUnwrap(SlopConsumer(descriptor: descriptor))
    let hello = try await consumer.connect()
    XCTAssertEqual(hello["provider"]?.objectValue?["id"], "swift-provider")

    let subscription = try await consumer.subscribe(path: "/", depth: -1)
    XCTAssertEqual(subscription.snapshot.children?.first?.id, "status")

    let queried = try await consumer.query(path: "/status", depth: 1)
    XCTAssertEqual(queried.properties?["healthy"], true)

    let result = try await consumer.invoke(path: "/status", action: "ping")
    XCTAssertEqual(result["status"], "ok")
    XCTAssertEqual(result["data"]?.objectValue?["pong"], true)
  }
  #endif

  func testDiscoveryDescriptorFilenameValidation() {
    XCTAssertTrue(Discovery.isValidDescriptorFilename("my-app_1.json"))
    XCTAssertFalse(Discovery.isValidDescriptorFilename("../bad.json"))
    XCTAssertFalse(Discovery.isValidDescriptorFilename("Bad.json"))
  }
}

private final class RecordingConnection: SlopConnection {
  var messages: [SlopMessage] = []

  func send(_ message: SlopMessage) {
    messages.append(message)
  }

  func onMessage(_ handler: @escaping (SlopMessage) -> Void) {}

  func onClose(_ handler: @escaping () -> Void) {}

  func close() {}
}

private final class MessageList: @unchecked Sendable {
  private let lock = NSLock()
  private var messages: [SlopMessage] = []

  func append(_ message: SlopMessage) {
    lock.lock()
    messages.append(message)
    lock.unlock()
  }

  func values() -> [SlopMessage] {
    lock.lock()
    let values = messages
    lock.unlock()
    return values
  }
}

private final class MessageBox: @unchecked Sendable {
  private let lock = NSLock()
  private var message: SlopMessage?

  func set(_ message: SlopMessage) {
    lock.lock()
    self.message = message
    lock.unlock()
  }

  func value() -> SlopMessage? {
    lock.lock()
    let value = message
    lock.unlock()
    return value
  }
}

private final class PipeJSONReader: @unchecked Sendable {
  private let handle: FileHandle
  private let lock = NSLock()
  private let semaphore = DispatchSemaphore(value: 0)
  private var messages: [SlopMessage] = []

  init(_ handle: FileHandle) {
    self.handle = handle
    DispatchQueue.global(qos: .utility).async { [weak self] in
      self?.readLoop()
    }
  }

  func next(timeout: TimeInterval = 3) -> SlopMessage? {
    guard semaphore.wait(timeout: .now() + timeout) == .success else {
      return nil
    }
    lock.lock()
    let message = messages.isEmpty ? nil : messages.removeFirst()
    lock.unlock()
    return message
  }

  private func readLoop() {
    var pending = Data()
    while true {
      let chunk = handle.readData(ofLength: 1)
      if chunk.isEmpty {
        return
      }
      if chunk.first == 0x0A {
        guard !pending.isEmpty else { continue }
        if case .object(let message) = try? JSONDecoder().decode(JSONValue.self, from: pending) {
          lock.lock()
          messages.append(message)
          lock.unlock()
          semaphore.signal()
        }
        pending.removeAll()
      } else {
        pending.append(chunk)
      }
    }
  }
}

private final class FakeBridge: DiscoveryBridge, @unchecked Sendable {
  private let lock = NSLock()
  private var relaySubscribers: [String: [BridgeRelayHandler]] = [:]
  private var sent: [SlopMessage] = []

  var running: Bool { true }

  func providers() -> [BridgeProvider] {
    [BridgeProvider(providerKey: "tab-1", id: "tab-app", name: "Tab App")]
  }

  @discardableResult
  func onProviderChange(_ callback: @escaping () -> Void) -> () -> Void {
    {}
  }

  @discardableResult
  func subscribeRelay(providerKey: String, handler: @escaping BridgeRelayHandler) -> () -> Void {
    lock.lock()
    relaySubscribers[providerKey, default: []].append(handler)
    lock.unlock()
    return { [weak self] in
      self?.lock.lock()
      self?.relaySubscribers[providerKey]?.removeAll()
      self?.lock.unlock()
    }
  }

  func send(_ message: SlopMessage) async throws {
    let providerKey = message["providerKey"]?.stringValue ?? ""
    let subscribers = locked { () -> [BridgeRelayHandler] in
      sent.append(message)
      return relaySubscribers[providerKey] ?? []
    }

    guard message["type"]?.stringValue == "slop-relay", let inner = message["message"]?.objectValue else {
      return
    }

    switch inner["type"]?.stringValue {
    case "connect":
      for subscriber in subscribers {
        subscriber([
          "type": "hello",
          "provider": .object(["id": "tab-1", "name": "Tab App", "slop_version": "0.1", "capabilities": []]),
        ])
      }
    case "subscribe":
      let id = inner["id"]?.stringValue ?? "sub-1"
      for subscriber in subscribers {
        subscriber(snapshotMessage(id: id, version: 1, seq: 0, tree: SlopNode(id: "tab-1", type: "root")))
      }
    default:
      break
    }
  }

  func stop() {}

  func sentTypes() -> [String] {
    locked {
      sent.compactMap { $0["type"]?.stringValue }
    }
  }

  private func locked<T>(_ body: () -> T) -> T {
    lock.lock()
    let value = body()
    lock.unlock()
    return value
  }
}

private func writePipeJSON(_ handle: FileHandle, _ message: SlopMessage) {
  guard var data = try? JSONEncoder().encode(JSONValue.object(message)) else { return }
  data.append(0x0A)
  handle.write(data)
}

private func waitUntil(
  timeout: TimeInterval = 3,
  file: StaticString = #filePath,
  line: UInt = #line,
  condition: @escaping () -> Bool
) async throws {
  let deadline = Date().addingTimeInterval(timeout)
  while Date() < deadline {
    if condition() {
      return
    }
    try await Task.sleep(nanoseconds: 20_000_000)
  }
  XCTFail("Timed out waiting for condition", file: file, line: line)
}

#if canImport(Darwin)
private func makeUnixListener(path: String) throws -> Int32 {
  Darwin.unlink(path)
  let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
  guard fd >= 0 else {
    throw SlopError.internalError("socket failed: \(testErrnoDescription())")
  }

  var address = sockaddr_un()
  address.sun_family = sa_family_t(AF_UNIX)
  let pathBytes = Array(path.utf8) + [0]
  guard pathBytes.count <= MemoryLayout.size(ofValue: address.sun_path) else {
    Darwin.close(fd)
    throw SlopError.internalError("socket path too long")
  }
  withUnsafeMutableBytes(of: &address.sun_path) { rawBuffer in
    rawBuffer.copyBytes(from: pathBytes)
  }

  let bindResult = withUnsafePointer(to: &address) { pointer in
    pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
      Darwin.bind(fd, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_un>.size))
    }
  }
  guard bindResult == 0 else {
    Darwin.close(fd)
    throw SlopError.internalError("bind failed: \(testErrnoDescription())")
  }

  guard Darwin.listen(fd, 1) == 0 else {
    Darwin.close(fd)
    throw SlopError.internalError("listen failed: \(testErrnoDescription())")
  }

  return fd
}

private func setReadTimeout(_ fd: Int32, seconds: Int) {
  var timeout = timeval(tv_sec: seconds, tv_usec: 0)
  withUnsafePointer(to: &timeout) { pointer in
    _ = pointer.withMemoryRebound(to: UInt8.self, capacity: MemoryLayout<timeval>.size) { rawPointer in
      Darwin.setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, rawPointer, socklen_t(MemoryLayout<timeval>.size))
    }
  }
}

private func writeUnixJSON(_ fd: Int32, _ message: SlopMessage) {
  guard var data = try? JSONEncoder().encode(JSONValue.object(message)) else { return }
  data.append(0x0A)
  data.withUnsafeBytes { rawBuffer in
    guard let base = rawBuffer.baseAddress else { return }
    var written = 0
    while written < data.count {
      let count = Darwin.write(fd, base.advanced(by: written), data.count - written)
      if count <= 0 {
        return
      }
      written += count
    }
  }
}

private func readUnixJSON(_ fd: Int32) -> SlopMessage? {
  var data = Data()
  var byte: UInt8 = 0
  while true {
    let count = Darwin.read(fd, &byte, 1)
    guard count == 1 else { return nil }
    if byte == 0x0A {
      break
    }
    data.append(byte)
  }
  guard case .object(let message) = try? JSONDecoder().decode(JSONValue.self, from: data) else {
    return nil
  }
  return message
}

private func testErrnoDescription() -> String {
  String(cString: strerror(errno))
}
#endif
