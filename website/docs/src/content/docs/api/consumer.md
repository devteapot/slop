---
title: "@slop-ai/consumer"
description: API reference for the SLOP consumer library
---

Consumer-side library for connecting to SLOP providers, subscribing to state, and invoking affordances.

```bash
bun add @slop-ai/consumer
```

For browser-only usage (no Node.js transports):
```ts
import { SlopConsumer } from "@slop-ai/consumer/browser";
```

## `SlopConsumer`

Connects to a SLOP provider, subscribes to state, and invokes actions.

```ts
import { SlopConsumer, WebSocketClientTransport } from "@slop-ai/consumer";

const transport = new WebSocketClientTransport("ws://localhost:3737/slop");
const consumer = new SlopConsumer(transport);

const hello = await consumer.connect();
console.log(`Connected to ${hello.provider.name}`);

const { id: subId, snapshot } = await consumer.subscribe("/", -1);
console.log(snapshot); // Full state tree

consumer.on("patch", (subscriptionId, ops, version) => {
  const tree = consumer.getTree(subscriptionId);
  console.log("State updated:", tree);
});

const result = await consumer.invoke("/todos/todo-1", "toggle");
console.log(result.status); // "ok"
```

### Methods

| Method | Returns | Description |
|---|---|---|
| `connect()` | `Promise<HelloMessage>` | Connect and wait for hello |
| `subscribe(path, depth)` | `Promise<{ id, snapshot }>` | Subscribe to a subtree |
| `unsubscribe(id)` | `void` | Stop subscribing |
| `query(path, depth)` | `Promise<SlopNode>` | One-shot read |
| `invoke(path, action, params?)` | `Promise<ResultMessage>` | Invoke an affordance |
| `getTree(subscriptionId)` | `SlopNode \| null` | Get current mirrored tree |
| `disconnect()` | `void` | Close connection |

### Events

- `"patch"` — `(subscriptionId, ops, version)` — state changed
- `"disconnect"` — connection lost

## Transports

### `WebSocketClientTransport`

```ts
new WebSocketClientTransport("ws://localhost:3737/slop")
```

### `PostMessageClientTransport`

For connecting to in-browser SPA providers:

```ts
new PostMessageClientTransport(chromeRuntimePort)
```

## LLM Tool Utilities

Convert SLOP trees to LLM tool call format:

```ts
import { affordancesToTools, formatTree, encodeTool, decodeTool } from "@slop-ai/consumer";

const tools = affordancesToTools(tree);  // → LLM tool definitions
const formatted = formatTree(tree);       // → readable string for LLM context
const toolName = encodeTool("/todos/todo-1", "toggle");  // → "invoke__todos__todo-1__toggle"
const { path, action } = decodeTool(toolName);            // → { path: "/todos/todo-1", action: "toggle" }
```
