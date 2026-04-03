---
title: "Consumer Guide"
description: "Tools and SDKs for connecting to, inspecting, and testing SLOP providers"
---
A SLOP consumer connects to a provider, subscribes to its state tree, and can invoke affordances. The repo ships three main consumer surfaces plus the reusable consumer SDKs.

## Which consumer should you use?

| Consumer | Best for | Where it lives |
| --- | --- | --- |
| CLI Inspector | fast debugging and manual affordance testing | `apps/cli` |
| Desktop app | multi-provider workspaces and AI chat | `apps/desktop` |
| Chrome extension | browser and SPA testing | `apps/extension` |

## CLI Inspector

The inspector is the fastest way to verify that a provider exposes the tree shape, patch stream, and affordances you expect.

### Build

```bash
cd apps/cli
go build -o slop-inspect .
```

Or run it directly:

```bash
cd apps/cli
go run .
```

### Connect to a provider

```bash
slop-inspect
slop-inspect --connect /tmp/slop/my-app.sock
slop-inspect --connect ws://localhost:3000/slop
```

## Desktop app

Use the desktop app when you want to connect to multiple providers at once and test AI chat across them.

```bash
cd apps/desktop
bun install
bun run dev
```

The desktop app watches `~/.slop/providers/` for local providers and can also connect to WebSocket endpoints directly.

## Chrome extension

Use the extension for in-browser providers and for testing the desktop bridge.

```bash
cd apps/extension
bun install
bun run build
```

Then open `chrome://extensions`, enable Developer mode, and load the `apps/extension` directory as an unpacked extension.

## Building a custom consumer

### TypeScript

```ts
import { SlopConsumer, WebSocketClientTransport } from "@slop-ai/consumer";

const consumer = new SlopConsumer(
  new WebSocketClientTransport("ws://localhost:3000/slop"),
);

const hello = await consumer.connect();
const { id, snapshot } = await consumer.subscribe("/", -1);
await consumer.invoke("/todos", "create", { title: "Ship docs" });

console.log(hello.provider.name, id, snapshot.id);
```

### Go

```go
transport := &slop.WSClientTransport{URL: "ws://localhost:3000/slop"}
consumer := slop.NewConsumer(transport)

hello, _ := consumer.Connect(context.Background())
subID, snapshot, _ := consumer.Subscribe(context.Background(), "/", -1)

fmt.Println(hello["provider"], subID, snapshot.ID)
```

## Next Steps

- [Consumer package API](/api/consumer)
- [Desktop app docs](/desktop/install)
- [Chrome extension docs](/extension/install)
