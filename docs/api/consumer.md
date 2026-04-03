# @slop-ai/consumer

`@slop-ai/consumer` is the TypeScript SDK for connecting to providers, subscribing to snapshots and patches, and invoking affordances from your own tools.

Use it when you want to build:

- a protocol inspector or debugging script
- an AI agent that turns affordances into model tools
- a browser or desktop consumer
- a smoke test that validates a provider contract end to end

The built-in consumers in this repo are all variations on these same primitives.

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
consumer.on("patch", (subscriptionId, ops, version) => {
  console.log("patch", subscriptionId, version, ops);
});

await consumer.invoke("/todos", "create", { title: "Ship docs" });

console.log(hello.provider.name);
console.log(snapshot);
console.log(consumer.getTree(id));
```

## Debugging a local provider

For Node.js scripts talking to a Unix socket provider, use `NodeSocketClientTransport`:

```ts
import {
  SlopConsumer,
  NodeSocketClientTransport,
  formatTree,
} from "@slop-ai/consumer";

const consumer = new SlopConsumer(
  new NodeSocketClientTransport("/tmp/slop/tsk.sock"),
);

const hello = await consumer.connect();
const root = await consumer.query("/", -1);

console.log("connected to", hello.provider.name);
console.log(formatTree(root));

const result = await consumer.invoke("/tasks", "add", {
  title: "Verify consumer docs",
  due: "today",
  tags: "docs",
});

console.log(result.status, result.data);
consumer.disconnect();
```

This is a good fit for quick debugging scripts and CI smoke tests because it lets you assert against the same tree and affordances an AI consumer would see.

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

### Example: turn affordances into model tools

```ts
import {
  SlopConsumer,
  WebSocketClientTransport,
  affordancesToTools,
  formatTree,
} from "@slop-ai/consumer";

const consumer = new SlopConsumer(
  new WebSocketClientTransport("ws://localhost:3737/slop"),
);

await consumer.connect();
const tree = await consumer.query("/", -1);

const toolSet = affordancesToTools(tree);

console.log(formatTree(tree));
console.log(toolSet.tools.map(tool => tool.function.name));

// Later, when the model chooses a tool:
const resolved = toolSet.resolve("tasks__add");
if (resolved) {
  await consumer.invoke(resolved.path, resolved.action, {
    title: "Created from tool call",
  });
}
```

This is the bridge between a SLOP provider and an LLM loop: expose the current affordances as tools, keep the formatted tree in context, and resolve the selected tool back into `invoke(path, action, params)`.

## Related pages

- [Consumer guide](/guides/consumer)
- [Go SDK](/api/go)
- [Python SDK](/api/python)
