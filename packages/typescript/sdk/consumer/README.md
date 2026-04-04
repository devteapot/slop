# `@slop-ai/consumer`

Consumer SDK for connecting to SLOP providers, mirroring state, and invoking actions.

Use it to build custom agents, testing tools, browser extensions, desktop apps, or protocol inspectors.

## Install

```bash
bun add @slop-ai/consumer
```

For browser-only bundles, use the browser-safe subpath:

```ts
import { SlopConsumer } from "@slop-ai/consumer/browser";
```

## Quick start

```ts
import { SlopConsumer, WebSocketClientTransport } from "@slop-ai/consumer";

const consumer = new SlopConsumer(
  new WebSocketClientTransport("ws://localhost:3000/slop"),
);

const hello = await consumer.connect();
const { id, snapshot } = await consumer.subscribe("/", -1);

console.log(hello.provider.name);
console.log(snapshot);

consumer.on("patch", (subscriptionId, ops, version) => {
  console.log(subscriptionId, ops, version);
});

await consumer.invoke("/todos", "create", { title: "Ship docs" });
console.log(consumer.getTree(id));
```

## Included utilities

- `StateMirror` for applying snapshots and patches
- `WebSocketClientTransport`, `PostMessageClientTransport`, and `NodeSocketClientTransport`
- `affordancesToTools()` and `formatTree()` for LLM integrations

## Documentation

- API reference: https://docs.slopai.dev/api/consumer
- Consumer guide: https://docs.slopai.dev/guides/consumer
- Go consumer docs: https://docs.slopai.dev/api/go
