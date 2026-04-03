---
title: "@slop-ai/consumer"
description: "Consumer SDK for connecting to providers, mirroring state, and invoking actions"
---
`@slop-ai/consumer` is the SDK for connecting to providers, subscribing to snapshots and patches, and invoking affordances from custom agents or tools.

```bash
bun add @slop-ai/consumer
```

For browser-only bundles, use the browser-safe entrypoint:

```ts
import { SlopConsumer } from "@slop-ai/consumer/browser";
```

## `SlopConsumer`

```ts
import { SlopConsumer, WebSocketClientTransport } from "@slop-ai/consumer";

const consumer = new SlopConsumer(
  new WebSocketClientTransport("ws://localhost:3737/slop"),
);

const hello = await consumer.connect();
const { id, snapshot } = await consumer.subscribe("/", -1);
await consumer.invoke("/todos", "create", { title: "Ship docs" });

console.log(hello.provider.name);
console.log(snapshot);
console.log(consumer.getTree(id));
```

### Methods

| Method | Returns | Description |
| --- | --- | --- |
| `connect()` | `Promise<HelloMessage>` | connect and wait for `hello` |
| `subscribe(path, depth, options?)` | `Promise<{ id, snapshot }>` | subscribe to a subtree |
| `unsubscribe(id)` | `void` | stop a subscription |
| `query(path, depth, options?)` | `Promise<SlopNode>` | one-shot read |
| `invoke(path, action, params?)` | `Promise<ResultMessage>` | invoke an affordance |
| `getTree(subscriptionId)` | `SlopNode \| null` | get the mirrored tree |
| `disconnect()` | `void` | close the connection |

## Transports

- `WebSocketClientTransport`
- `PostMessageClientTransport`
- `NodeSocketClientTransport`

## LLM tool helpers

The package also exports:

- `affordancesToTools()`
- `formatTree()`
- `Emitter`

## Related pages

- [Consumer guide](/guides/consumer)
- [Go SDK](/api/go)
- [Python SDK](/api/python)
