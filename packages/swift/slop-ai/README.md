# SlopAI Swift SDK

Swift Package Manager SDK for the SLOP protocol.

This package mirrors the TypeScript SDK's core behavior while using Swift-native
types and Codable wire models:

- wire types for nodes, affordances, metadata, content references, patches, and schemas
- descriptor normalization with Swift closures for action handlers
- tree assembly from path registrations
- tree diffing, scaling, filtering, windowing, and subtree lookup
- invoke parameter validation
- provider/server registration, subscription, query, invoke, event, and patch handling
- consumer-side state mirror and affordance-to-tool helpers
- `URLSessionWebSocketTransport` for iOS/macOS consumers
- `UnixSocketClientTransport` for local macOS consumers
- provider transports for Unix sockets, stdio NDJSON, and SwiftNIO WebSocket servers
- local provider descriptor registration/reading with ownership and permission hardening
- bridge discovery and relay transport support for browser-backed providers
- `DiscoveryService` for local and bridge-backed providers

## Quick Start

```swift
import SlopAI

let slop = SlopServer(id: "todos", name: "Todos")

try slop.register("list", descriptor: NodeDescriptor(
  type: "collection",
  props: ["count": 1],
  items: [
    ItemDescriptor(id: "first", props: ["title": "Write Swift SDK"])
  ],
  actions: [
    "clear": .value(dangerous: true) { _ in
      .object(["ok": true])
    }
  ]
))

print(formatTree(slop.tree))
```

## iOS Consumer

```swift
import SlopAI

let transport = URLSessionWebSocketTransport(
  url: URL(string: "ws://127.0.0.1:7777/slop")!
)
let consumer = SlopConsumer(transport: transport)

let hello = try await consumer.connect()
let subscription = try await consumer.subscribe(path: "/", depth: 2)
let result = try await consumer.invoke(path: "/button", action: "press")

print(hello)
print(formatTree(subscription.snapshot))
print(result)
```

## macOS Unix Socket Consumer

```swift
import SlopAI

let transport = UnixSocketClientTransport(path: "/tmp/slop/my-app.sock")
let consumer = SlopConsumer(transport: transport)

_ = try await consumer.connect()
let subscription = try await consumer.subscribe(path: "/", depth: -1)
let tree = try await consumer.query(path: "/", depth: 2)

print(formatTree(subscription.snapshot))
print(formatTree(tree))
```

## macOS App Provider

Make a Swift macOS app SLOP-native by registering state on a `SlopServer` and
listening on a local Unix socket:

```swift
import SlopAI

let slop = SlopServer(id: "notes", name: "Notes")

try slop.register("document", descriptor: NodeDescriptor(
  type: "document",
  props: ["title": "Draft"],
  actions: [
    "rename": action(params: ["title": .type("string")]) { params in
      .object(["title": params["title"] ?? .null])
    }
  ]
))

let listener = try slop.listenUnix(
  path: "/tmp/slop/notes.sock",
  discover: true
)

// Keep `listener` alive for as long as the app should expose SLOP.
```

## App Intents Adapter

On Apple platforms, reuse `AppEntity` and `AppIntent` types as the source for
SLOP nodes and affordances. The adapter keeps the mapping explicit because App
Intents doesn't expose a supported runtime API for enumerating every entity
property or mutating arbitrary intent parameters.

```swift
import AppIntents
import SlopAI

let noteAdapter = AppEntityAdapter<NoteEntity>(
  type: "notes:note",
  properties: { note in
    ["modified": .string(note.modified.formatted(.iso8601))]
  },
  actions: { note in
    [
      "open": .appIntent(
        OpenNoteIntent.self,
        makeIntent: { _ in OpenNoteIntent(note: note) }
      )
    ]
  }
)

try slop.registerAppEntities(
  "notes",
  entities: notes,
  adapter: noteAdapter,
  properties: ["count": .number(Double(notes.count))]
)
```

The projection automatically includes the entity's display title, subtitle,
and original App Intents identifier. App-specific properties and result values
must be mapped to `JSONValue`. On the 27 releases,
`registerAppEntityCollection` can resolve and publish an `EntityCollection`.

Calling an `AppIntent` through SLOP runs the same `perform()` implementation,
but it doesn't pass through the Siri/Shortcuts dispatcher. App Intents
authentication policy, automatic system confirmation, presentation,
interaction donations, and `LongRunningIntent` progress UI therefore aren't
applied to the SLOP invocation. Continue to authorize in the provider and set
`dangerous: true` where the SLOP consumer must confirm. Use SLOP task nodes when
progress must also be visible to a SLOP consumer.

## Provider Transports

Expose a provider over stdio NDJSON:

```swift
let stdio = slop.listenStdio()
```

Expose a provider over WebSocket:

```swift
let ws = try slop.listenWebSocket(
  options: WebSocketProviderOptions(
    host: "127.0.0.1",
    port: 8765,
    path: "/slop"
  )
)
```

WebSocket upgrades follow the same default security posture as the other SDKs:
browser upgrades require an `allowedOrigins` allowlist, and non-loopback
upgrades require an `authenticate` callback.

## Bridge Relay

Bridge-backed browser providers can be discovered and consumed through the
relay transport:

```swift
let bridge = BridgeClient()
bridge.start()

let discovery = DiscoveryService(
  options: DiscoveryOptions(bridges: [bridge])
)

if let provider = try await discovery.ensureConnected("browser-tab") {
  print(formatTree(provider.consumer.getTree(subscriptionID: provider.subscriptionID)!))
}
```

Or connect from a local discovery descriptor:

```swift
let discovery = DiscoveryService()
await discovery.start()

if let provider = try await discovery.ensureConnected("todos") {
  print(formatTree(provider.consumer.getTree(subscriptionID: provider.subscriptionID)!))
}
```

You can also create a consumer directly from a discovery descriptor when its
transport is supported:

```swift
if let consumer = SlopConsumer(descriptor: descriptor) {
  _ = try await consumer.connect()
  let tree = try await consumer.query(path: "/", depth: 2)
  print(formatTree(tree))
}
```

Run the package tests with:

```sh
swift test
```
