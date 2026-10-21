import XCTest
@testable import SlopAI
import NIOCore
import NIOEmbedded
import NIOHTTP1
import NIOWebSocket

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

  func testDescriptorNormalizationRejectsDuplicateSiblingIDs() throws {
    let duplicateItems = NodeDescriptor(
      type: "collection",
      items: [ItemDescriptor(id: "same"), ItemDescriptor(id: "same")]
    )
    XCTAssertThrowsError(try normalizeDescriptor(path: "items", id: "items", descriptor: duplicateItems)) { error in
      guard case .duplicateNodeId = error as? SlopError else {
        return XCTFail("Expected duplicateNodeId, got \(error)")
      }
    }

    let itemChildCollision = NodeDescriptor(
      type: "collection",
      items: [ItemDescriptor(id: "same")],
      children: ["same": NodeDescriptor(type: "panel")]
    )
    XCTAssertThrowsError(try normalizeDescriptor(path: "items", id: "items", descriptor: itemChildCollision)) { error in
      guard case .duplicateNodeId = error as? SlopError else {
        return XCTFail("Expected duplicateNodeId, got \(error)")
      }
    }
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

    let mirror = try StateMirror(snapshot: SnapshotMessage(id: "sub-1", version: 1, seq: 0, tree: old))
    try mirror.applyPatch(PatchMessage(subscription: "sub-1", version: 2, seq: 1, ops: ops))
    XCTAssertEqual(mirror.getTree(), new)
    XCTAssertEqual(mirror.getVersion(), 2)
    XCTAssertThrowsError(try mirror.applyPatch(PatchMessage(subscription: "sub-1", version: 3, seq: 3, ops: [])))
  }

  func testStateMirrorRollsBackMalformedPatches() throws {
    let original = SlopNode(id: "root", type: "root", properties: ["title": "Original"])
    let mirror = try StateMirror(snapshot: SnapshotMessage(id: "sub", version: 1, seq: 0, tree: original))
    let patch = PatchMessage(
      subscription: "sub",
      version: 2,
      seq: 1,
      ops: [
        PatchOp(op: .replace, path: "/properties/title", value: "Changed"),
        PatchOp(op: .replace, path: "/meta", value: "invalid-meta"),
      ]
    )

    XCTAssertThrowsError(try mirror.applyPatch(patch))
    XCTAssertEqual(mirror.getTree(), original)
    XCTAssertEqual(mirror.getVersion(), 1)
    XCTAssertEqual(mirror.getSeq(), 0)
  }

  func testStateMirrorRequiresSubscriptionSnapshotSequenceZero() {
    let tree = SlopNode(id: "root", type: "root")
    XCTAssertThrowsError(
      try StateMirror(snapshot: SnapshotMessage(id: "query-1", version: 1, tree: tree))
    )
    XCTAssertThrowsError(
      try StateMirror(snapshot: SnapshotMessage(id: "sub-1", version: 1, seq: 2, tree: tree))
    )
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

  func testJSONIntegerConversionRejectsOutOfRangeAndFractionalNumbers() {
    XCTAssertNil(JSONValue.number(1e300).intValue)
    XCTAssertNil(JSONValue.number(1.5).intValue)
    XCTAssertEqual(JSONValue.number(42).intValue, 42)
    XCTAssertEqual(canonicalJSON(.number(42)), "42")
    XCTAssertFalse(canonicalJSON(.number(1e300)).isEmpty)
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

  func testScalingProducesUniqueASCIIOnlyToolNamesAfterSanitizing() {
    let root = SlopNode(
      id: "app",
      type: "root",
      children: [
        SlopNode(id: "你", type: "item", affordances: [Affordance(action: "做")]),
        SlopNode(id: "_", type: "item", affordances: [Affordance(action: "_")]),
      ]
    )

    let tools = affordancesToTools(root)
    let names = tools.tools.map(\.function.name)
    XCTAssertEqual(names.count, 2)
    XCTAssertEqual(Set(names).count, 2)
    XCTAssertTrue(names.allSatisfy { name in
      name.unicodeScalars.allSatisfy { scalar in
        let value = scalar.value
        return (48...57).contains(value) || (65...90).contains(value) || (97...122).contains(value) || value == 95
      }
    })
    XCTAssertEqual(Set(names.compactMap { tools.resolve($0)?.action }), Set(["做", "_"]))
  }

  func testDynamicToolNamesAreGloballyUniqueASCIIAndOrderIndependent() {
    func connectedProvider(id: String) -> ConnectedProvider {
      let consumer = SlopConsumer(transport: InMemoryTransport())
      let tree = SlopNode(
        id: id,
        type: "root",
        children: [SlopNode(id: "button", type: "control", affordances: [Affordance(action: "press")])]
      )
      consumer.receive(snapshotMessage(id: "sub-1", version: 1, seq: 0, tree: tree))
      let descriptor = ProviderDescriptor(
        id: id,
        name: id,
        slopVersion: "0.1",
        transport: ProviderTransport(type: .ws, url: "ws://memory/\(id)"),
        capabilities: ["state", "affordances"]
      )
      return ConnectedProvider(
        id: id,
        name: id,
        descriptor: descriptor,
        consumer: consumer,
        subscriptionID: "sub-1",
        status: "connected"
      )
    }

    let providers = [connectedProvider(id: "foo-bar"), connectedProvider(id: "foo_bar"), connectedProvider(id: "你")]
    let forward = createDynamicTools(providers: providers)
    let reversed = createDynamicTools(providers: providers.reversed())
    let names = forward.tools.map(\.name)

    XCTAssertEqual(names, reversed.tools.map(\.name))
    XCTAssertEqual(names.count, Set(names).count)
    XCTAssertTrue(names.allSatisfy { name in
      name.unicodeScalars.allSatisfy { scalar in
        let value = scalar.value
        return (48...57).contains(value) || (65...90).contains(value) || (97...122).contains(value) || value == 95
      }
    })
    XCTAssertEqual(Set(names.compactMap { forward.resolve($0)?.providerID }), Set(["foo-bar", "foo_bar", "你"]))
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

  func testServerRefreshesDynamicStateWhenActionThrows() async throws {
    let server = SlopServer(id: "dynamic", name: "Dynamic")
    var count = 0
    try server.registerDynamic("status") {
      NodeDescriptor(
        type: "status",
        props: ["count": .number(Double(count))],
        actions: [
          "mutateThenFail": .value { _ in
            count += 1
            throw TestActionError.failed
          }
        ]
      )
    }

    let connection = RecordingConnection()
    server.handleConnection(connection)
    await server.handleMessage(["type": "subscribe", "id": "sub-dynamic", "path": "/status", "depth": 1], from: connection)
    let initialMessageCount = connection.messages.count

    await server.handleMessage(
      ["type": "invoke", "id": "inv-dynamic", "path": "/status", "action": "mutateThenFail", "params": [:]],
      from: connection
    )

    let messages = Array(connection.messages.dropFirst(initialMessageCount))
    XCTAssertEqual(messages.map { $0["type"]?.stringValue }, ["patch", "result"])
    XCTAssertEqual(messages.first?["ops"]?.arrayValue?.first?.objectValue?["value"], 1)
    XCTAssertEqual(messages.last?["status"], "error")
  }

  func testServerClampsHostileWindowRangesWithoutOverflow() throws {
    let server = SlopServer(id: "window", name: "Window")
    try server.register(
      "list",
      descriptor: NodeDescriptor(
        type: "list",
        items: [ItemDescriptor(id: "a"), ItemDescriptor(id: "b"), ItemDescriptor(id: "c")]
      )
    )

    let large = try server.outputTree(OutputRequest(path: "/list", window: WindowRange(1, Int.max)))
    XCTAssertEqual(large.children?.map(\.id), ["b", "c"])
    let negative = try server.outputTree(OutputRequest(path: "/list", window: WindowRange(1, -1)))
    XCTAssertEqual(negative.children, [])
  }

  func testAttachedServerProcessesMessagesInWireOrder() async throws {
    let server = SlopServer(id: "ordered", name: "Ordered")
    let gate = TestAsyncGate()
    let actionStarted = TestFlag()
    try server.register(
      "status",
      descriptor: NodeDescriptor(
        type: "status",
        actions: [
          "wait": .value { _ in
            actionStarted.set()
            await gate.wait()
            return .null
          }
        ]
      )
    )
    let outbound = MessageList()
    let connection = InMemoryConnection { outbound.append($0) }
    server.attachConnection(connection)

    connection.receive(["type": "invoke", "id": "first", "path": "/status", "action": "wait", "params": [:]])
    connection.receive(["type": "query", "id": "second", "path": "/status"])
    try await waitUntil { actionStarted.value }
    XCTAssertFalse(outbound.values().contains { $0["id"] == "second" })

    await gate.open()
    try await waitUntil { outbound.values().contains { $0["id"] == "second" } }
    let responses = outbound.values().filter { $0["id"] == "first" || $0["id"] == "second" }
    XCTAssertEqual(responses.map { $0["id"]?.stringValue }, ["first", "second"])
  }

  func testConsumerConnectWiresIncomingMessagesWithoutRetainingUntrackedSnapshots() async throws {
    let connection = InMemoryConnection { _ in }
    let consumer = SlopConsumer(transport: InMemoryTransport(connection: connection))
    let receivedEvent = TestFlag()
    consumer.onEvent { name, _ in
      if name == "ready" {
        receivedEvent.set()
      }
    }

    let helloTask = Task { try await consumer.connect() }
    await connection.waitForMessageHandler()
    connection.receive([
      "type": "hello",
      "provider": .object(["id": "app", "name": "App", "slop_version": "0.1", "capabilities": ["state"]]),
    ])

    let message = try await helloTask.value
    XCTAssertEqual(message["type"], "hello")

    let snapshot = SlopNode(id: "app", type: "root")
    connection.receive(snapshotMessage(id: "sub-1", version: 1, seq: 0, tree: snapshot))
    connection.receive(["type": "event", "name": "ready"])
    XCTAssertNil(consumer.getTree(subscriptionID: "sub-1"))
    XCTAssertTrue(receivedEvent.value)
  }

  func testConsumerRejectsMalformedHelloIdentity() async throws {
    let connection = InMemoryConnection { _ in }
    let consumer = SlopConsumer(transport: InMemoryTransport(connection: connection))
    let connectTask = Task { try await consumer.connect() }
    await connection.waitForMessageHandler()
    connection.receive([
      "type": "hello",
      "provider": .object(["id": "app", "name": "App", "slop_version": "0.1", "capabilities": []]),
    ])

    do {
      _ = try await connectTask.value
      XCTFail("Expected hello without the required state capability to be rejected")
    } catch {
      XCTAssertTrue(error.localizedDescription.contains("state capability"))
    }
  }

  func testConsumerCallbacksRunOutsideStateLock() async throws {
    let connection = InMemoryConnection { _ in }
    let consumer = SlopConsumer(transport: InMemoryTransport(connection: connection))
    let sendableConsumer = UncheckedSendable(consumer)
    consumer.onEvent { _, _ in
      let completed = DispatchSemaphore(value: 0)
      DispatchQueue.global(qos: .userInitiated).async {
        _ = sendableConsumer.value.getTree(subscriptionID: "missing")
        completed.signal()
      }
      XCTAssertEqual(completed.wait(timeout: .now() + 1), .success)
    }

    let helloTask = Task { try await consumer.connect() }
    await connection.waitForMessageHandler()
    connection.receive([
      "type": "hello",
      "provider": .object(["id": "app", "name": "App", "slop_version": "0.1", "capabilities": ["state"]]),
    ])
    _ = try await helloTask.value

    connection.receive(["type": "event", "name": "ready"])
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
      "provider": .object(["id": "app", "name": "App", "slop_version": "0.1", "capabilities": ["state"]]),
    ])
    _ = try await helloTask.value

    connection.receive(["type": "event", "name": "ready"])
    unsubscribe()
    connection.receive(["type": "event", "name": "ignored"])
    connection.close()

    XCTAssertEqual(events, ["ready"])
    XCTAssertEqual(disconnects, 1)
  }

  func testConsumerCallbackUnsubscribesUseStableTokens() {
    let consumer = SlopConsumer(transport: InMemoryTransport())
    var events: [String] = []
    let unsubscribeFirst = consumer.onEvent { _, _ in events.append("first") }
    let unsubscribeSecond = consumer.onEvent { _, _ in events.append("second") }

    unsubscribeFirst()
    consumer.receive(["type": "event", "name": "one"])
    unsubscribeSecond()
    consumer.receive(["type": "event", "name": "two"])

    XCTAssertEqual(events, ["second"])
  }

  func testConsumerReportsMalformedPatchWithoutTrapping() {
    let consumer = SlopConsumer(transport: InMemoryTransport())
    let errors = MessageList()
    consumer.onError { error, id in
      var message = error
      if let id {
        message["id"] = .string(id)
      }
      errors.append(message)
    }
    consumer.receive(snapshotMessage(id: "sub-invalid", version: 1, seq: 0, tree: SlopNode(id: "root", type: "root")))

    consumer.receive([
      "type": "patch",
      "subscription": "sub-invalid",
      "version": 2,
      "seq": 1,
      "ops": .array([
        .object(["op": "replace", "path": "/meta", "value": "invalid-meta"]),
      ]),
    ])

    XCTAssertEqual(errors.values().first?["code"], "invalid_patch")
    XCTAssertEqual(errors.values().first?["id"], "sub-invalid")
    XCTAssertNil(consumer.getTree(subscriptionID: "sub-invalid"))
  }

  func testConsumerRejectsSubscriptionPatchWithoutSequence() {
    let consumer = SlopConsumer(transport: InMemoryTransport())
    let errors = MessageList()
    consumer.onError { error, id in
      var message = error
      if let id {
        message["id"] = .string(id)
      }
      errors.append(message)
    }
    consumer.receive(snapshotMessage(id: "sub-missing-seq", version: 1, seq: 0, tree: SlopNode(id: "root", type: "root")))

    consumer.receive([
      "type": "patch",
      "subscription": "sub-missing-seq",
      "version": 2,
      "ops": .array([]),
    ])

    XCTAssertEqual(errors.values().first?["code"], "invalid_patch")
    XCTAssertEqual(errors.values().first?["id"], "sub-missing-seq")
    XCTAssertNil(consumer.getTree(subscriptionID: "sub-missing-seq"))
  }

  func testConsumerRejectsInitialSubscriptionSnapshotWithoutSequenceZero() async throws {
    var connection: InMemoryConnection!
    connection = InMemoryConnection { message in
      guard message["type"] == "subscribe", let id = message["id"]?.stringValue else { return }
      connection.receive(snapshotMessage(id: id, version: 1, seq: 1, tree: SlopNode(id: "root", type: "root")))
    }
    let consumer = SlopConsumer(transport: InMemoryTransport(connection: connection))
    let helloTask = Task { try await consumer.connect() }
    await connection.waitForMessageHandler()
    connection.receive([
      "type": "hello",
      "provider": .object(["id": "app", "name": "App", "slop_version": "0.1", "capabilities": ["state"]]),
    ])
    _ = try await helloTask.value

    do {
      _ = try await consumer.subscribe()
      XCTFail("Expected subscription snapshot with seq 1 to be rejected")
    } catch {
      XCTAssertTrue(error.localizedDescription.contains("seq 0"))
    }
    XCTAssertNil(consumer.getTree(subscriptionID: "sub-1"))
  }

  func testConsumerRejectsMalformedQuerySnapshotInsteadOfSuspending() async throws {
    var connection: InMemoryConnection!
    connection = InMemoryConnection { message in
      guard message["type"] == "query", let id = message["id"]?.stringValue else { return }
      connection.receive([
        "type": "snapshot",
        "id": .string(id),
        "version": 1,
        "tree": "not-a-tree",
      ])
    }
    let consumer = SlopConsumer(transport: InMemoryTransport(connection: connection))
    let helloTask = Task { try await consumer.connect() }
    await connection.waitForMessageHandler()
    connection.receive([
      "type": "hello",
      "provider": .object(["id": "app", "name": "App", "slop_version": "0.1", "capabilities": ["state"]]),
    ])
    _ = try await helloTask.value

    do {
      _ = try await consumer.query()
      XCTFail("Expected malformed query snapshot to be rejected")
    } catch {
      XCTAssertTrue(error.localizedDescription.contains("invalid tree"))
    }
  }

  func testConsumerRecoversFromMalformedPatchBody() {
    let consumer = SlopConsumer(transport: InMemoryTransport())
    let errors = MessageList()
    consumer.onError { error, id in
      var message = error
      if let id {
        message["id"] = .string(id)
      }
      errors.append(message)
    }
    consumer.receive(snapshotMessage(id: "sub-invalid-ops", version: 1, seq: 0, tree: SlopNode(id: "root", type: "root")))

    consumer.receive([
      "type": "patch",
      "subscription": "sub-invalid-ops",
      "version": 2,
      "seq": 1,
      "ops": "not-operations",
    ])

    XCTAssertEqual(errors.values().first?["code"], "invalid_patch")
    XCTAssertEqual(errors.values().first?["id"], "sub-invalid-ops")
    XCTAssertNil(consumer.getTree(subscriptionID: "sub-invalid-ops"))
  }

  func testConsumerRejectsPendingRequestsWhenConnectionCloses() async throws {
    let sent = MessageList()
    let connection = InMemoryConnection { message in sent.append(message) }
    let consumer = SlopConsumer(transport: InMemoryTransport(connection: connection))
    let helloTask = Task { try await consumer.connect() }
    await connection.waitForMessageHandler()
    connection.receive([
      "type": "hello",
      "provider": .object(["id": "app", "name": "App", "slop_version": "0.1", "capabilities": ["state"]]),
    ])
    _ = try await helloTask.value

    let queryTask = Task { try await consumer.query() }
    try await waitUntil {
      sent.values().contains { $0["type"] == "query" }
    }
    connection.close()

    do {
      _ = try await queryTask.value
      XCTFail("Expected the pending query to fail when the connection closed")
    } catch let error as SlopError {
      guard case .internalError(let message) = error else {
        return XCTFail("Expected internalError, got \(error)")
      }
      XCTAssertEqual(message, "SLOP connection closed")
    }
  }

  func testConsumerDisconnectRejectsLateTransportConnection() async throws {
    let transport = SuspendingClientTransport()
    let consumer = SlopConsumer(transport: transport)
    let connectTask = Task { try await consumer.connect() }
    try await waitUntil { transport.connectCount == 1 }

    consumer.disconnect()
    await transport.release()

    do {
      _ = try await connectTask.value
      XCTFail("Expected the stale connection to be rejected")
    } catch {}
    XCTAssertTrue(transport.connectionClosed)
  }

  func testConsumerCancellationRemovesPendingRequestsAndSubscriptions() async throws {
    let sent = MessageList()
    let connection = InMemoryConnection { sent.append($0) }
    let consumer = SlopConsumer(transport: InMemoryTransport(connection: connection))
    let connectTask = Task { try await consumer.connect() }
    await connection.waitForMessageHandler()
    connection.receive([
      "type": "hello",
      "provider": .object(["id": "app", "name": "App", "slop_version": "0.1", "capabilities": ["state"]]),
    ])
    _ = try await connectTask.value

    let queryTask = Task { try await consumer.query() }
    try await waitUntil { sent.values().contains { $0["type"] == "query" } }
    let queryID = try XCTUnwrap(sent.values().first { $0["type"] == "query" }?["id"]?.stringValue)
    queryTask.cancel()
    do {
      _ = try await queryTask.value
      XCTFail("Expected query cancellation")
    } catch is CancellationError {}
    connection.receive(snapshotMessage(id: queryID, version: 1, tree: SlopNode(id: "late", type: "root")))
    XCTAssertNil(consumer.getTree(subscriptionID: queryID))

    let subscribeTask = Task { try await consumer.subscribe() }
    try await waitUntil { sent.values().contains { $0["type"] == "subscribe" } }
    let subscriptionID = try XCTUnwrap(sent.values().first { $0["type"] == "subscribe" }?["id"]?.stringValue)
    subscribeTask.cancel()
    do {
      _ = try await subscribeTask.value
      XCTFail("Expected subscription cancellation")
    } catch is CancellationError {}
    connection.receive(snapshotMessage(id: subscriptionID, version: 1, seq: 0, tree: SlopNode(id: "late", type: "root")))
    XCTAssertNil(consumer.getTree(subscriptionID: subscriptionID))
  }

  func testConsumerSerializesConcurrentRequestIDsAndResponses() async throws {
    let sent = MessageList()
    var connection: InMemoryConnection!
    connection = InMemoryConnection { message in
      guard message["type"] == "query", let id = message["id"]?.stringValue else { return }
      sent.append(message)
      DispatchQueue.global(qos: .userInitiated).async {
        connection.receive(
          snapshotMessage(id: id, version: 1, tree: SlopNode(id: "app", type: "root"))
        )
      }
    }
    let consumer = SlopConsumer(transport: InMemoryTransport(connection: connection))
    let helloTask = Task { try await consumer.connect() }
    await connection.waitForMessageHandler()
    connection.receive([
      "type": "hello",
      "provider": .object(["id": "app", "name": "App", "slop_version": "0.1", "capabilities": ["state"]]),
    ])
    _ = try await helloTask.value

    try await withThrowingTaskGroup(of: SlopNode.self) { group in
      for _ in 0..<100 {
        group.addTask {
          try await consumer.query()
        }
      }
      for try await tree in group {
        XCTAssertEqual(tree.id, "app")
      }
    }

    let ids = sent.values().compactMap { $0["id"]?.stringValue }
    XCTAssertEqual(ids.count, 100)
    XCTAssertEqual(Set(ids).count, 100)
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
      "provider": .object(["id": "app", "name": "App", "slop_version": "0.1", "capabilities": ["state"]]),
    ])
    _ = try await helloTask.value

    let subscription = try await consumer.subscribe(path: "/", depth: -1)
    XCTAssertEqual(subscription.snapshot.children?.first?.id, "panel")
    XCTAssertEqual(consumer.getTree(subscriptionID: subscription.id)?.id, "app")

    let queried = try await consumer.query(path: "/", depth: 1)
    XCTAssertEqual(queried.children?.first?.type, "view")
    let queryID = try XCTUnwrap(sent.values().first { $0["type"] == "query" }?["id"]?.stringValue)
    XCTAssertNil(consumer.getTree(subscriptionID: queryID))

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

  func testTaskHandleHonorsCancellationBeforeAttach() async throws {
    let server = SlopServer(id: "tasks", name: "Tasks")
    let handle = TaskHandle(id: "race", server: server, label: nil, cancelable: true)
    let observedCancellation = TestFlag()
    handle.cancel()
    let task = Task {
      while !Task.isCancelled {
        await Task.yield()
      }
      observedCancellation.set()
    }

    handle.attach(task)

    try await waitUntil { observedCancellation.value }
    handle.update(progress: 0.5, message: "Must stay cancelled")
    XCTAssertEqual(getSubtree(server.tree, path: "/tasks/race")?.properties?["status"], "cancelled")
  }

  func testExposeStoreSerializesUpdatesAndDisposal() async throws {
    let store = TestIntStore()
    let target = TestStoreTarget()
    let exposure = try exposeStore(
      target: target,
      path: .dynamic { "value-\($0)" },
      store: store,
      project: { NodeDescriptor(type: "value", props: ["value": .number(Double($0))]) },
      options: ExposeStoreOptions(debounceMilliseconds: 1)
    )

    await withTaskGroup(of: Void.self) { group in
      for value in 1...50 {
        group.addTask { store.set(value) }
      }
    }
    exposure.unsubscribe()
    let operationsAfterDispose = target.operationCount
    store.set(999)
    try await Task.sleep(nanoseconds: 5_000_000)

    XCTAssertEqual(target.operationCount, operationsAfterDispose)
  }

  func testExposeStoreSubscribesBeforeInitialSnapshot() throws {
    let store = TransitionDuringSubscribeStore()
    let target = TestStoreTarget()
    let exposure = try exposeStore(
      target: target,
      path: .dynamic { "value-\($0)" },
      store: store,
      project: { _ in NodeDescriptor(type: "value") }
    )
    defer { exposure.unsubscribe() }

    XCTAssertEqual(target.lastRegisteredPath, "value-1")
  }

  func testExposeStorePropagatesInitialRegistrationFailure() {
    XCTAssertThrowsError(
      try exposeStore(
        target: FailingStoreTarget(),
        path: .fixed("invalid"),
        store: TestIntStore(),
        project: { _ in NodeDescriptor(type: "value") }
      )
    )
  }

  func testExposeStoreKeepsOldDynamicPathWhenNewRegistrationFails() throws {
    let store = TestIntStore()
    let target = TransitionFailingStoreTarget(failingPath: "value-1")
    let exposure = try exposeStore(
      target: target,
      path: .dynamic { "value-\($0)" },
      store: store,
      project: { _ in NodeDescriptor(type: "value") }
    )
    defer { exposure.unsubscribe() }

    store.set(1)

    XCTAssertTrue(target.contains("value-0"))
    XCTAssertFalse(target.contains("value-1"))
  }

  func testStoreAndBridgeDelayConversionsClampLargeValues() throws {
    let store = TestIntStore()
    let exposure = try exposeStore(
      target: TestStoreTarget(),
      path: .fixed("value"),
      store: store,
      project: { _ in NodeDescriptor(type: "value") },
      options: ExposeStoreOptions(debounceMilliseconds: Int.max)
    )
    store.set(1)
    exposure.unsubscribe()

    _ = BridgeClient(reconnectDelay: .infinity)
    _ = BridgeClient(reconnectDelay: .nan)
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

  func testConcurrentDescriptorUnregistersPreserveNewestRegistration() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let registrations = ProviderRegistrationList()

    DispatchQueue.concurrentPerform(iterations: 40) { index in
      if let registration = try? Discovery.registerProvider(
        id: "shared-app",
        name: "Concurrent \(index)",
        transport: ProviderTransport(type: .ws, url: "ws://memory/\(index)"),
        directory: directory
      ) {
        registrations.append(registration)
      }
    }
    let newest = try Discovery.registerProvider(
      id: "shared-app",
      name: "Newest",
      transport: ProviderTransport(type: .ws, url: "ws://memory/newest"),
      directory: directory
    )

    let oldRegistrations = registrations.values()
    DispatchQueue.concurrentPerform(iterations: oldRegistrations.count) { index in
      Discovery.unregisterProvider(oldRegistrations[index])
    }

    let descriptor = try XCTUnwrap(Discovery.readDescriptors(from: [directory]).first)
    XCTAssertEqual(descriptor.name, "Newest")
    XCTAssertEqual(descriptor.transport.url, "ws://memory/newest")
    Discovery.unregisterProvider(newest)
  }

  func testDescriptorQuarantineIsRemovedWhenNewerRegistrationWinsRestore() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let old = try Discovery.registerProvider(
      id: "shared-app",
      name: "Old",
      transport: ProviderTransport(type: .ws, url: "ws://memory/old"),
      directory: directory
    )
    _ = try Discovery.registerProvider(
      id: "shared-app",
      name: "Superseded",
      transport: ProviderTransport(type: .ws, url: "ws://memory/superseded"),
      directory: directory
    )
    var newest: ProviderRegistration?

    Discovery.unregisterProvider(old) {
      newest = try? Discovery.registerProvider(
        id: "shared-app",
        name: "Newest",
        transport: ProviderTransport(type: .ws, url: "ws://memory/newest"),
        directory: directory
      )
    }

    let descriptor = try XCTUnwrap(Discovery.readDescriptors(from: [directory]).first)
    XCTAssertEqual(descriptor.name, "Newest")
    let files = try FileManager.default.contentsOfDirectory(atPath: directory.path)
    XCTAssertFalse(files.contains { $0.hasPrefix(".slop-unregister-") })
    if let newest {
      Discovery.unregisterProvider(newest)
    }
  }

  func testDiscoveryRejectsSymlinkProviderDirectory() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let realDirectory = root.appendingPathComponent("real")
    let linkedDirectory = root.appendingPathComponent("linked")
    defer { try? FileManager.default.removeItem(at: root) }
    try FileManager.default.createDirectory(at: realDirectory, withIntermediateDirectories: true)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: realDirectory.path)
    try FileManager.default.createSymbolicLink(at: linkedDirectory, withDestinationURL: realDirectory)
    let permissionsBefore = try XCTUnwrap(
      FileManager.default.attributesOfItem(atPath: realDirectory.path)[.posixPermissions] as? NSNumber
    )

    XCTAssertThrowsError(
      try Discovery.registerProvider(
        id: "swift-app",
        name: "Swift App",
        transport: ProviderTransport(type: .ws, url: "ws://127.0.0.1:7777/slop"),
        directory: linkedDirectory
      )
    )
    XCTAssertFalse(FileManager.default.fileExists(atPath: linkedDirectory.appendingPathComponent("swift-app.json").path))
    let permissionsAfter = try XCTUnwrap(
      FileManager.default.attributesOfItem(atPath: realDirectory.path)[.posixPermissions] as? NSNumber
    )
    XCTAssertEqual(permissionsAfter, permissionsBefore)
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

  func testUnixProviderStartRollsBackWhenDiscoveryRegistrationFails() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let socketPath = directory.appendingPathComponent("provider.sock").path
    let invalidDiscoveryDirectory = directory.appendingPathComponent("not-a-directory")
    try Data().write(to: invalidDiscoveryDirectory)
    let server = SlopServer(id: "rollback-provider", name: "Rollback Provider")
    let transport = UnixSocketProviderTransport(server: server, path: socketPath)

    XCTAssertThrowsError(try transport.start(discover: true, discoveryDirectory: invalidDiscoveryDirectory))
    XCTAssertFalse(FileManager.default.fileExists(atPath: socketPath))

    try transport.start()
    XCTAssertTrue(FileManager.default.fileExists(atPath: socketPath))
    transport.stop()
  }

  func testUnixProviderRejectsWorldWritableSocketDirectory() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try FileManager.default.setAttributes([.posixPermissions: 0o777], ofItemAtPath: directory.path)
    defer { try? FileManager.default.removeItem(at: directory) }

    let socketPath = directory.appendingPathComponent("provider.sock").path
    let transport = UnixSocketProviderTransport(
      server: SlopServer(id: "unsafe-provider", name: "Unsafe Provider"),
      path: socketPath
    )

    XCTAssertThrowsError(try transport.start())
    XCTAssertFalse(FileManager.default.fileExists(atPath: socketPath))
  }

  func testUnixProviderPreservesRegularFileAtSocketPath() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let socketURL = directory.appendingPathComponent("provider.sock")
    let original = Data("keep me".utf8)
    try original.write(to: socketURL)
    let transport = UnixSocketProviderTransport(
      server: SlopServer(id: "safe-provider", name: "Safe Provider"),
      path: socketURL.path
    )

    XCTAssertThrowsError(try transport.start())
    XCTAssertEqual(try Data(contentsOf: socketURL), original)
  }

  func testUnixProviderStopPreservesReplacementPath() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let socketURL = directory.appendingPathComponent("provider.sock")
    let movedSocketURL = directory.appendingPathComponent("provider-old.sock")
    let replacement = Data("replacement".utf8)
    let transport = UnixSocketProviderTransport(
      server: SlopServer(id: "replacement-provider", name: "Replacement Provider"),
      path: socketURL.path
    )
    try transport.start()
    try FileManager.default.moveItem(at: socketURL, to: movedSocketURL)
    try replacement.write(to: socketURL)

    transport.stop()

    XCTAssertEqual(try Data(contentsOf: socketURL), replacement)
  }

  func testUnixProviderPreservesReplacementCreatedDuringConditionalCleanup() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let socketURL = directory.appendingPathComponent("provider.sock")
    let replacement = Data("replacement-during-cleanup".utf8)
    let transport = UnixSocketProviderTransport(
      server: SlopServer(id: "racing-provider", name: "Racing Provider"),
      path: socketURL.path,
      beforeQuarantineInspection: {
        try? replacement.write(to: socketURL)
      }
    )
    try transport.start()

    transport.stop()

    XCTAssertEqual(try Data(contentsOf: socketURL), replacement)
  }

  func testUnixProviderRemovesSupersededQuarantineWhenNewerPathWinsRestore() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let socketURL = directory.appendingPathComponent("provider.sock")
    let movedSocketURL = directory.appendingPathComponent("provider-old.sock")
    let superseded = Data("superseded".utf8)
    let newest = Data("newest".utf8)
    let transport = UnixSocketProviderTransport(
      server: SlopServer(id: "quarantine-provider", name: "Quarantine Provider"),
      path: socketURL.path,
      beforeQuarantineInspection: {
        try? newest.write(to: socketURL)
      }
    )
    try transport.start()
    try FileManager.default.moveItem(at: socketURL, to: movedSocketURL)
    try superseded.write(to: socketURL)

    transport.stop()

    XCTAssertEqual(try Data(contentsOf: socketURL), newest)
    let files = try FileManager.default.contentsOfDirectory(atPath: directory.path)
    XCTAssertFalse(files.contains { $0.contains(".slop-remove-") })
  }

  func testUnixProviderRefusesToReplaceLiveSocket() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let socketPath = directory.appendingPathComponent("provider.sock").path
    let first = UnixSocketProviderTransport(
      server: SlopServer(id: "first-provider", name: "First Provider"),
      path: socketPath
    )
    let second = UnixSocketProviderTransport(
      server: SlopServer(id: "second-provider", name: "Second Provider"),
      path: socketPath
    )
    try first.start()
    defer { first.stop() }

    XCTAssertThrowsError(try second.start())
    XCTAssertTrue(FileManager.default.fileExists(atPath: socketPath))
  }

  func testUnixProviderStopDoesNotRemoveNewerDescriptorRegistration() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let discoveryDirectory = directory.appendingPathComponent("providers")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let socketPath = directory.appendingPathComponent("old.sock").path
    let transport = UnixSocketProviderTransport(
      server: SlopServer(id: "shared-provider", name: "Old Provider"),
      path: socketPath
    )
    try transport.start(discover: true, discoveryDirectory: discoveryDirectory)
    try Discovery.registerUnixProvider(
      id: "shared-provider",
      name: "New Provider",
      socketPath: directory.appendingPathComponent("new.sock").path,
      directory: discoveryDirectory
    )

    transport.stop()

    let descriptor = try XCTUnwrap(Discovery.readDescriptors(from: [discoveryDirectory]).first)
    XCTAssertEqual(descriptor.name, "New Provider")
    XCTAssertTrue(descriptor.transport.path?.hasSuffix("new.sock") == true)
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

    let factoryCalls = TestCounter()
    let service = DiscoveryService(
      options: DiscoveryOptions(providerDirectories: [directory]) { _ in
        factoryCalls.increment()
        return InMemoryTransport(connection: connection)
      }
    )
    let firstConnectTask = Task { try await service.ensureConnected("memory-app") }
    let secondConnectTask = Task { try await service.ensureConnected("Memory App") }
    await connection.waitForMessageHandler()
    connection.receive([
      "type": "hello",
      "provider": .object(["id": "memory-app", "name": "Memory App", "slop_version": "0.1", "capabilities": ["state"]]),
    ])
    let firstConnectedProvider = try await firstConnectTask.value
    let secondConnectedProvider = try await secondConnectTask.value
    let provider = try XCTUnwrap(firstConnectedProvider)
    let secondProvider = try XCTUnwrap(secondConnectedProvider)

    XCTAssertEqual(provider.id, "memory-app")
    XCTAssertTrue(provider.consumer === secondProvider.consumer)
    XCTAssertEqual(factoryCalls.value, 1)
    XCTAssertEqual(service.getProviders().count, 1)
    let dynamic = createDynamicTools(providers: service.getProviders())
    XCTAssertEqual(dynamic.tools.first?.name, "memory_app__button__press")
    XCTAssertTrue(service.disconnect("Memory App"))
  }

  func testDiscoveryUsesAuthoritativeHelloIdentity() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    try Discovery.registerProvider(
      id: "advertised-app",
      name: "Advertised App",
      transport: ProviderTransport(type: .ws, url: "ws://memory/slop"),
      directory: directory
    )

    var connection: InMemoryConnection!
    connection = InMemoryConnection { message in
      guard message["type"] == "subscribe", let id = message["id"]?.stringValue else { return }
      connection.receive(
        snapshotMessage(id: id, version: 1, seq: 0, tree: SlopNode(id: "actual-app", type: "root"))
      )
    }
    let service = DiscoveryService(
      options: DiscoveryOptions(providerDirectories: [directory]) { _ in
        InMemoryTransport(connection: connection)
      }
    )
    let connectTask = Task { try await service.ensureConnected("advertised-app") }
    await connection.waitForMessageHandler()
    connection.receive([
      "type": "hello",
      "provider": .object([
        "id": "actual-app",
        "name": "Actual App",
        "slop_version": "0.1",
        "capabilities": ["state", "patches"],
      ]),
    ])

    let connectedProvider = try await connectTask.value
    let provider = try XCTUnwrap(connectedProvider)
    XCTAssertEqual(provider.id, "actual-app")
    XCTAssertEqual(provider.name, "Actual App")
    XCTAssertEqual(provider.descriptor.id, "actual-app")
    XCTAssertEqual(provider.descriptor.capabilities, ["state", "patches"])
    XCTAssertTrue(service.getProvider("advertised-app")?.consumer === provider.consumer)
    XCTAssertTrue(service.getProvider("actual-app")?.consumer === provider.consumer)
    let secondProvider = try await service.ensureConnected("advertised-app")
    XCTAssertTrue(secondProvider?.consumer === provider.consumer)
    XCTAssertTrue(service.disconnect("advertised-app"))
    XCTAssertNil(service.getProvider("actual-app"))
  }

  func testDiscoveryCanonicalIDTakesPrecedenceOverDescriptorAlias() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    try Discovery.registerProvider(
      id: "foo",
      name: "Foo Advertisement",
      transport: ProviderTransport(type: .ws, url: "ws://memory/foo"),
      directory: directory
    )
    try Discovery.registerProvider(
      id: "baz",
      name: "Baz Advertisement",
      transport: ProviderTransport(type: .ws, url: "ws://memory/baz"),
      directory: directory
    )

    var fooConnection: InMemoryConnection!
    fooConnection = InMemoryConnection { message in
      guard message["type"] == "subscribe", let id = message["id"]?.stringValue else { return }
      fooConnection.receive(snapshotMessage(id: id, version: 1, seq: 0, tree: SlopNode(id: "bar", type: "root")))
    }
    var bazConnection: InMemoryConnection!
    bazConnection = InMemoryConnection { message in
      guard message["type"] == "subscribe", let id = message["id"]?.stringValue else { return }
      bazConnection.receive(snapshotMessage(id: id, version: 1, seq: 0, tree: SlopNode(id: "foo", type: "root")))
    }
    let service = DiscoveryService(
      options: DiscoveryOptions(providerDirectories: [directory]) { descriptor in
        InMemoryTransport(connection: descriptor.id == "foo" ? fooConnection : bazConnection)
      }
    )

    let aliasTask = Task { try await service.ensureConnected("foo") }
    await fooConnection.waitForMessageHandler()
    fooConnection.receive([
      "type": "hello",
      "provider": .object(["id": "bar", "name": "Bar", "slop_version": "0.1", "capabilities": ["state"]]),
    ])
    let aliasProvider = try await aliasTask.value

    let canonicalTask = Task { try await service.ensureConnected("baz") }
    await bazConnection.waitForMessageHandler()
    bazConnection.receive([
      "type": "hello",
      "provider": .object(["id": "foo", "name": "Canonical Foo", "slop_version": "0.1", "capabilities": ["state"]]),
    ])
    let canonicalProvider = try await canonicalTask.value

    XCTAssertTrue(service.getProvider("foo")?.consumer === canonicalProvider?.consumer)
    XCTAssertTrue(service.getProvider("bar")?.consumer === aliasProvider?.consumer)
    XCTAssertTrue(service.disconnect("foo"))
    XCTAssertTrue(service.getProvider("bar")?.consumer === aliasProvider?.consumer)
  }

  func testDiscoveryStateCallbacksUseStableTokens() {
    let service = DiscoveryService(options: DiscoveryOptions(providerDirectories: []))
    var events: [String] = []
    let unsubscribeFirst = service.onStateChange { events.append("first") }
    let unsubscribeSecond = service.onStateChange { events.append("second") }

    unsubscribeFirst()
    service.scan()
    unsubscribeSecond()
    service.scan()

    XCTAssertEqual(events, ["second"])
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

  func testStdioConnectionFiresLateCloseHandlers() {
    let connection = StdioConnection(input: Pipe().fileHandleForReading, output: Pipe().fileHandleForWriting)
    connection.close()
    var closeCount = 0

    connection.onClose { closeCount += 1 }

    XCTAssertEqual(closeCount, 1)
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

    var rejectedRequest = URLRequest(url: url)
    rejectedRequest.setValue("https://evil.example", forHTTPHeaderField: "Origin")
    let rejectedConsumer = SlopConsumer(transport: URLSessionWebSocketTransport(request: rejectedRequest))
    do {
      _ = try await rejectedConsumer.connect()
      XCTFail("Expected the provider to reject an untrusted browser origin")
    } catch {
      XCTAssertNotNil(error as? SlopError)
    }
  }

  func testWebSocketHandlersPongAndAggregateFragments() throws {
    let server = SlopServer(id: "embedded", name: "Embedded")
    let pingChannel = EmbeddedChannel(handler: WebSocketProviderHandler(server: server))
    let hello: WebSocketFrame? = try pingChannel.readOutbound()
    XCTAssertEqual(hello?.opcode, .text)

    let pingData = pingChannel.allocator.buffer(string: "heartbeat")
    XCTAssertTrue(try pingChannel.writeInbound(WebSocketFrame(fin: true, opcode: .ping, data: pingData)).isEmpty)
    let pong: WebSocketFrame? = try pingChannel.readOutbound()
    XCTAssertEqual(pong?.opcode, .pong)
    var pongData = try XCTUnwrap(pong).unmaskedData
    XCTAssertEqual(pongData.readString(length: pongData.readableBytes), "heartbeat")
    XCTAssertNoThrow(try pingChannel.finish())

    let aggregateChannel = EmbeddedChannel(handler: makeWebSocketFrameAggregator())
    let first = aggregateChannel.allocator.buffer(string: "{\"type\":")
    let second = aggregateChannel.allocator.buffer(string: "\"query\"}")
    XCTAssertTrue(try aggregateChannel.writeInbound(WebSocketFrame(fin: false, opcode: .text, data: first)).isEmpty)
    XCTAssertTrue(try aggregateChannel.writeInbound(WebSocketFrame(fin: true, opcode: .continuation, data: second)).isFull)
    let aggregated: WebSocketFrame? = try aggregateChannel.readInbound()
    XCTAssertEqual(aggregated?.opcode, .text)
    var aggregatedData = try XCTUnwrap(aggregated).unmaskedData
    XCTAssertEqual(aggregatedData.readString(length: aggregatedData.readableBytes), "{\"type\":\"query\"}")
    XCTAssertNoThrow(try aggregateChannel.finish())
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

  func testBridgeDisconnectClosesRelayConsumerAndPendingRequests() async throws {
    let bridge = FakeBridge()
    let consumer = SlopConsumer(transport: BridgeRelayTransport(bridge: bridge, providerKey: "tab-1"))
    _ = try await consumer.connect()
    let queryTask = Task { try await consumer.query() }
    try await waitUntil {
      bridge.sentInnerTypes().contains("query")
    }

    bridge.simulateDisconnect()

    do {
      _ = try await queryTask.value
      XCTFail("Expected bridge loss to fail the pending relay query")
    } catch {
      XCTAssertNotNil(error as? SlopError)
    }
  }

  func testBridgeRelayConnectionSerializesSuspendedSends() async throws {
    let bridge = SuspendingBridge()
    let connection = BridgeRelayConnection(bridge: bridge, providerKey: "tab-1", unsubscribe: {})

    connection.send(["type": "first"])
    connection.send(["type": "second"])
    try await waitUntil { bridge.sentInnerTypes() == ["first"] }
    XCTAssertEqual(bridge.sentInnerTypes(), ["first"])

    await bridge.releaseFirstSend()
    try await waitUntil { bridge.sentInnerTypes() == ["first", "second"] }
  }

  func testBridgeServerStopNotifiesRelayConnections() throws {
    let bridge = BridgeServer(port: 0)
    let connection = BridgeRelayConnection(bridge: bridge, providerKey: "tab-1", unsubscribe: {})
    let closed = TestFlag()
    let unsubscribe = bridge.onDisconnect {
      connection.bridgeDidDisconnect()
    }
    defer { unsubscribe() }
    connection.onClose { closed.set() }

    try bridge.start()
    bridge.stop()

    XCTAssertTrue(closed.value)
  }

  func testBridgeClientStopNotifiesDisconnectOnce() async throws {
    let server = BridgeServer(port: 0)
    try server.start()
    defer { server.stop() }
    let client = BridgeClient(url: try XCTUnwrap(server.url.flatMap(URL.init(string:))))
    try await client.connectOnce()
    let disconnects = TestCounter()
    let unsubscribe = client.onDisconnect { disconnects.increment() }
    defer { unsubscribe() }

    client.stop()
    try await Task.sleep(nanoseconds: 20_000_000)

    XCTAssertEqual(disconnects.value, 1)
  }

  func testBridgeClientSingleFlightsConnectAndRejectsPostStopResult() async throws {
    let transport = SuspendingClientTransport()
    let client = BridgeClient(transportFactory: { transport })
    let disconnects = TestCounter()
    client.onDisconnect { disconnects.increment() }
    let first = Task { try await client.connectOnce() }
    let second = Task { try await client.connectOnce() }
    try await waitUntil { transport.connectCount == 1 }

    client.stop()
    client.stop()
    await transport.release()

    do {
      try await first.value
      XCTFail("Expected stopped connection attempt to fail")
    } catch {}
    do {
      try await second.value
      XCTFail("Expected stopped connection attempt to fail")
    } catch {}
    XCTAssertEqual(transport.connectCount, 1)
    XCTAssertEqual(disconnects.value, 1)
    XCTAssertTrue(transport.connectionClosed)
  }

  func testBridgeClientIgnoresMessagesFromStoppedConnection() async throws {
    let connection = InMemoryConnection()
    let client = BridgeClient(transportFactory: { InMemoryTransport(connection: connection) })
    try await client.connectOnce()
    client.stop()

    connection.receive([
      "type": "provider-available",
      "providerKey": "stale",
      "provider": .object(["id": "stale", "name": "Stale", "transport": "postmessage"]),
    ])

    XCTAssertTrue(client.providers().isEmpty)
  }

  func testBridgeServerTracksProvidersAndDispatchesRelay() async throws {
    let bridge = BridgeServer(
      port: 0,
      allowedOrigins: ["https://trusted.example"],
      authenticate: { head, _ in
        head.headers.first(name: "Authorization") == "Bearer bridge-secret"
      }
    )
    try bridge.start()
    defer { bridge.stop() }

    let url = try XCTUnwrap(bridge.url.flatMap(URL.init(string:)))
    var rejectedRequest = URLRequest(url: url)
    rejectedRequest.setValue("https://evil.example", forHTTPHeaderField: "Origin")
    rejectedRequest.setValue("Bearer bridge-secret", forHTTPHeaderField: "Authorization")
    let rejectedConsumer = SlopConsumer(transport: URLSessionWebSocketTransport(request: rejectedRequest))
    do {
      _ = try await rejectedConsumer.connect()
      XCTFail("Expected the bridge to reject an untrusted browser origin")
    } catch {
      XCTAssertNotNil(error as? SlopError)
    }

    var authorizedRequest = URLRequest(url: url)
    authorizedRequest.setValue("https://trusted.example", forHTTPHeaderField: "Origin")
    authorizedRequest.setValue("Bearer bridge-secret", forHTTPHeaderField: "Authorization")
    let connection = try await URLSessionWebSocketTransport(request: authorizedRequest).connect()
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

    let secondConnection = try await URLSessionWebSocketTransport(request: authorizedRequest).connect()
    defer { secondConnection.close() }
    let secondMessages = MessageList()
    secondConnection.onMessage { secondMessages.append($0) }
    secondConnection.send([
      "type": "provider-available",
      "providerKey": "tab-second",
      "provider": .object(["id": "second", "name": "Second", "transport": "postmessage"]),
    ])
    try await waitUntil { bridge.providers().count == 2 }

    connection.close()
    try await waitUntil {
      bridge.providers().map(\.providerKey) == ["tab-second"]
    }
    try await waitUntil {
      secondMessages.values().contains {
        $0["type"] == "provider-unavailable" && $0["providerKey"] == "tab-bridge"
      }
    }
  }

  func testBridgeWebSocketPolicyRejectsUnauthorizedUpgrades() throws {
    let remoteAddress = try SocketAddress(ipAddress: "127.0.0.1", port: 9000)
    var untrusted = HTTPRequestHead(version: .http1_1, method: .GET, uri: defaultBridgePath)
    untrusted.headers.add(name: "Origin", value: "https://evil.example")
    untrusted.headers.add(name: "Authorization", value: "Bearer bridge-secret")

    XCTAssertFalse(
      isAllowedWebSocketUpgrade(
        untrusted,
        remoteAddress: remoteAddress,
        path: defaultBridgePath,
        allowedOrigins: ["https://trusted.example"],
        authenticate: { head, _ in
          head.headers.first(name: "Authorization") == "Bearer bridge-secret"
        }
      )
    )

    var unauthenticated = HTTPRequestHead(version: .http1_1, method: .GET, uri: defaultBridgePath)
    unauthenticated.headers.add(name: "Origin", value: "https://trusted.example")
    XCTAssertFalse(
      isAllowedWebSocketUpgrade(
        unauthenticated,
        remoteAddress: remoteAddress,
        path: defaultBridgePath,
        allowedOrigins: ["https://trusted.example"],
        authenticate: { head, _ in
          head.headers.first(name: "Authorization") == "Bearer bridge-secret"
        }
      )
    )
  }

  #if canImport(Darwin)
  func testUnixSocketConnectFailsWhenPeerClosesBeforeHandlersRegister() async throws {
    let socketPath = "/tmp/slop-close-\(UUID().uuidString.prefix(8)).sock"
    let listener = try makeUnixListener(path: socketPath)
    defer {
      Darwin.close(listener)
      Darwin.unlink(socketPath)
    }
    DispatchQueue.global(qos: .utility).async {
      let fd = Darwin.accept(listener, nil, nil)
      guard fd >= 0 else { return }
      Darwin.close(fd)
    }

    let consumer = SlopConsumer(transport: UnixSocketClientTransport(path: socketPath))
    do {
      _ = try await consumer.connect()
      XCTFail("Expected connect to fail when the peer closed before hello")
    } catch {
      XCTAssertNotNil(error as? SlopError)
    }
  }

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
            "capabilities": ["state"],
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
    XCTAssertFalse(Discovery.isValidDescriptorFilename("é.json"))
    XCTAssertFalse(Discovery.isValidDescriptorFilename("١.json"))
  }
}

private enum TestActionError: Error {
  case failed
}

private final class UncheckedSendable<Value>: @unchecked Sendable {
  let value: Value

  init(_ value: Value) {
    self.value = value
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

private final class ProviderRegistrationList: @unchecked Sendable {
  private let lock = NSLock()
  private var registrations: [ProviderRegistration] = []

  func append(_ registration: ProviderRegistration) {
    lock.lock()
    registrations.append(registration)
    lock.unlock()
  }

  func values() -> [ProviderRegistration] {
    lock.lock()
    defer { lock.unlock() }
    return registrations
  }
}

private final class TestFlag: @unchecked Sendable {
  private let lock = NSLock()
  private var storage = false

  var value: Bool {
    lock.lock()
    defer { lock.unlock() }
    return storage
  }

  func set() {
    lock.lock()
    storage = true
    lock.unlock()
  }
}

private final class TestCounter: @unchecked Sendable {
  private let lock = NSLock()
  private var storage = 0

  var value: Int {
    lock.lock()
    defer { lock.unlock() }
    return storage
  }

  func increment() {
    lock.lock()
    storage += 1
    lock.unlock()
  }
}

private actor TestAsyncGate {
  private var isOpen = false
  private var waiters: [CheckedContinuation<Void, Never>] = []

  func wait() async {
    guard !isOpen else { return }
    await withCheckedContinuation { continuation in
      waiters.append(continuation)
    }
  }

  func open() {
    isOpen = true
    let pending = waiters
    waiters.removeAll()
    for continuation in pending {
      continuation.resume()
    }
  }
}

private final class TestStoreSubscription: StoreSubscription, @unchecked Sendable {
  private let lock = NSLock()
  private var callback: (() -> Void)?

  init(_ callback: @escaping () -> Void) {
    self.callback = callback
  }

  func unsubscribe() {
    lock.lock()
    let callback = callback
    self.callback = nil
    lock.unlock()
    callback?()
  }
}

private final class TestIntStore: StateStore, @unchecked Sendable {
  private let lock = NSLock()
  private var state = 0
  private var listeners: [UUID: () -> Void] = [:]

  func getState() -> Int {
    lock.lock()
    defer { lock.unlock() }
    return state
  }

  @discardableResult
  func subscribe(_ listener: @escaping () -> Void) -> StoreSubscription {
    let token = UUID()
    lock.lock()
    listeners[token] = listener
    lock.unlock()
    return TestStoreSubscription { [weak self] in
      self?.lock.lock()
      self?.listeners.removeValue(forKey: token)
      self?.lock.unlock()
    }
  }

  func set(_ value: Int) {
    lock.lock()
    state = value
    let callbacks = Array(listeners.values)
    lock.unlock()
    for callback in callbacks {
      callback()
    }
  }
}

private final class TransitionDuringSubscribeStore: StateStore {
  private var state = 0

  func getState() -> Int {
    state
  }

  @discardableResult
  func subscribe(_ listener: @escaping () -> Void) -> StoreSubscription {
    state = 1
    return TestStoreSubscription {}
  }
}

private final class TestStoreTarget: StoreTarget, @unchecked Sendable {
  private let lock = NSLock()
  private var operations = 0
  private var registeredPath: String?

  var operationCount: Int {
    lock.lock()
    defer { lock.unlock() }
    return operations
  }

  var lastRegisteredPath: String? {
    lock.lock()
    defer { lock.unlock() }
    return registeredPath
  }

  func register(_ path: String, descriptor: NodeDescriptor) throws {
    lock.lock()
    operations += 1
    registeredPath = path
    lock.unlock()
  }

  func unregister(_ path: String, recursive: Bool) throws {
    lock.lock()
    operations += 1
    lock.unlock()
  }
}

private struct FailingStoreTarget: StoreTarget {
  func register(_ path: String, descriptor: NodeDescriptor) throws {
    throw SlopError.invalidNodeId("Rejected test path")
  }

  func unregister(_ path: String, recursive: Bool) throws {}
}

private final class TransitionFailingStoreTarget: StoreTarget, @unchecked Sendable {
  private let lock = NSLock()
  private let failingPath: String
  private var paths: Set<String> = []

  init(failingPath: String) {
    self.failingPath = failingPath
  }

  func register(_ path: String, descriptor: NodeDescriptor) throws {
    guard path != failingPath else {
      throw SlopError.invalidNodeId("Rejected test path")
    }
    lock.lock()
    paths.insert(path)
    lock.unlock()
  }

  func unregister(_ path: String, recursive: Bool) throws {
    lock.lock()
    paths.remove(path)
    lock.unlock()
  }

  func contains(_ path: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return paths.contains(path)
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
  private var disconnectCallbacks: [UUID: () -> Void] = [:]
  private var sent: [SlopMessage] = []
  private var connected = true

  var running: Bool { true }

  func providers() -> [BridgeProvider] {
    [BridgeProvider(providerKey: "tab-1", id: "tab-app", name: "Tab App")]
  }

  @discardableResult
  func onProviderChange(_ callback: @escaping () -> Void) -> () -> Void {
    {}
  }

  @discardableResult
  func onDisconnect(_ callback: @escaping () -> Void) -> () -> Void {
    let token = UUID()
    locked {
      disconnectCallbacks[token] = callback
    }
    return { [weak self] in
      _ = self?.locked {
        self?.disconnectCallbacks.removeValue(forKey: token)
      }
    }
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
    let subscribers = try locked { () throws -> [BridgeRelayHandler] in
      guard connected else {
        throw SlopError.internalError("Bridge disconnected")
      }
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
          "provider": .object(["id": "tab-1", "name": "Tab App", "slop_version": "0.1", "capabilities": ["state"]]),
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

  func sentInnerTypes() -> [String] {
    locked {
      sent.compactMap { $0["message"]?.objectValue?["type"]?.stringValue }
    }
  }

  func simulateDisconnect() {
    let callbacks = locked { () -> [() -> Void] in
      connected = false
      return Array(disconnectCallbacks.values)
    }
    for callback in callbacks {
      callback()
    }
  }

  private func locked<T>(_ body: () throws -> T) rethrows -> T {
    lock.lock()
    defer { lock.unlock() }
    return try body()
  }
}

private final class SuspendingClientTransport: ClientTransport, @unchecked Sendable {
  private let gate = TestAsyncGate()
  private let counter = TestCounter()
  private let closed = TestFlag()
  private let connection: InMemoryConnection

  init() {
    connection = InMemoryConnection()
    connection.onClose { [closed] in closed.set() }
  }

  var connectCount: Int { counter.value }
  var connectionClosed: Bool { closed.value }

  func connect() async throws -> SlopConnection {
    counter.increment()
    await gate.wait()
    return connection
  }

  func release() async {
    await gate.open()
  }
}

private final class SuspendingBridge: DiscoveryBridge, @unchecked Sendable {
  private let lock = NSLock()
  private let firstSendGate = TestAsyncGate()
  private var innerTypes: [String] = []

  var running: Bool { true }

  func providers() -> [BridgeProvider] {
    [BridgeProvider(providerKey: "tab-1")]
  }

  @discardableResult
  func onProviderChange(_ callback: @escaping () -> Void) -> () -> Void {
    {}
  }

  @discardableResult
  func onDisconnect(_ callback: @escaping () -> Void) -> () -> Void {
    {}
  }

  @discardableResult
  func subscribeRelay(providerKey: String, handler: @escaping BridgeRelayHandler) -> () -> Void {
    {}
  }

  func send(_ message: SlopMessage) async throws {
    let count: Int = locked {
      if let type = message["message"]?.objectValue?["type"]?.stringValue {
        innerTypes.append(type)
      }
      return innerTypes.count
    }
    if count == 1 {
      await firstSendGate.wait()
    }
  }

  func stop() {}

  func sentInnerTypes() -> [String] {
    locked { innerTypes }
  }

  func releaseFirstSend() async {
    await firstSendGate.open()
  }

  private func locked<T>(_ body: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return body()
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
