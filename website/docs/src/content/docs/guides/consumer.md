---
title: "Consumer Guide"
description: "Tools and SDKs for connecting to, inspecting, and testing SLOP providers"
---
A SLOP consumer connects to a provider, reads its state tree, and can invoke affordances. This repo ships three ready-made consumers plus reusable SDKs for building your own scripts, agents, and test harnesses.

## Which consumer should you use?

| Consumer | What it actually does | Best for | Where it lives |
| --- | --- | --- | --- |
| CLI Inspector | Connects to one provider, mirrors the live tree, logs snapshots and patches, and lets you invoke affordances manually | protocol debugging, smoke tests, manual QA | `apps/cli` |
| Desktop app | Groups providers into workspaces, shows their trees, and runs chat across connected providers | multi-provider testing, desktop workflows, cross-app debugging | `apps/desktop` |
| Chrome extension | Detects browser providers, opens an on-page chat UI, and can bridge browser state into the desktop app | browser and SPA testing, in-page AI workflows | `apps/extension` |
| Consumer SDKs | Lets you build scripts, agents, and automated tests on top of subscribe/query/invoke | custom automation, CI checks, tool calling | `packages/typescript/consumer`, `packages/python/slop-ai`, `packages/go/slop-ai`, `packages/rust/slop-ai` |

## CLI Inspector

The inspector is the fastest way to answer: "what is this provider exposing right now?"

It is effectively a Postman-style debugger for SLOP providers:

- connect to a local Unix socket or remote WebSocket provider
- see the current tree shape exactly as a consumer sees it
- watch the patch stream while you use the app normally
- invoke affordances by hand without writing a custom script
- confirm whether a bug is in the provider, in the consumer, or in the AI layer

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

### Example workflows

#### Use it like Postman for affordances

Run a provider, connect the inspector, then invoke actions manually to confirm the provider contract is correct.

```bash
# Terminal A
cd examples/cli/go
go run . --slop

# Terminal B
cd apps/cli
go run . --connect /tmp/slop/tsk.sock
```

From there you can select `/tasks`, press `enter`, choose `add`, fill in the params, and verify that:

- the affordance exists on the node you expect
- the input schema matches what the UI or AI will send
- the result payload is correct
- the tree updates immediately after the invoke

#### Watch the patch stream while you use the app

Leave the inspector connected, then mutate the provider from somewhere else:

```bash
# In the provider terminal
add "Review launch checklist" --due tomorrow --tag work
done t-1
```

The inspector log shows the snapshots, patches, results, and errors in arrival order. This is useful when a provider looks correct in its own UI but the AI is still acting on stale or incomplete state.

#### Smoke-test a remote provider

If your provider is exposed over WebSocket, the inspector is a quick connectivity check before you bring in a larger consumer:

```bash
slop-inspect --connect ws://localhost:3000/slop
```

If you can connect, browse the tree, and invoke a safe affordance, the transport and provider are usually wired correctly.

### Writing tests with it

Yes, with one important nuance: today the CLI is most useful for authoring and validating tests, and its wire-level pieces are a solid base for headless runners.

Use it in two stages:

- first, connect with the inspector to discover the exact paths, affordances, params, and patch behavior your test should care about
- then, encode those expectations in an automated harness that connects over Unix socket or WebSocket and asserts on snapshots, results, and follow-up queries

That is already the pattern used in this repo. `examples/cli/test-harness.ts` spins up the sample `tsk` providers, connects over the socket, sends `subscribe`, `query`, and `invoke` messages, and checks that the returned tree and results match expectations.

So the CLI is useful for tests in three practical ways:

- as a fast manual test authoring tool, like using Postman before writing an API test
- as a debugging aid when a CI failure says "tree shape changed" and you need to inspect the live provider
- as a reference architecture for a future dedicated test runner

The repo's `apps/cli/TESTING.md` also sketches where this could go next: declarative specs, replayable recordings, and snapshot-style assertions.

## Desktop app

Use the desktop app when you want a real consumer workspace rather than a single connection.

The desktop app:

- auto-discovers local providers from `~/.slop/providers/` and `/tmp/slop/providers/`
- lets you add WebSocket providers manually
- groups providers into workspaces
- shows a live tree viewer for connected providers
- runs AI chat across the providers in the active workspace
- accepts browser providers from the extension bridge

```bash
cd apps/desktop
bun install
bun run dev
```

The desktop app scans both `~/.slop/providers/` and `/tmp/slop/providers/` for local providers and can also connect to WebSocket endpoints directly.

### Before you chat

The desktop app starts with a default local Ollama profile at `http://localhost:11434` using `qwen2.5:14b`.

If you want to use a hosted model:

1. Open `Settings`.
2. Add or edit a profile for OpenAI, OpenRouter, or Gemini.
3. Enter the endpoint and API key for that provider.
4. Use the top-bar selectors to switch the active profile and model.

The active profile is global to the desktop app. Workspaces control connected providers and chat history, not which model backend is selected.

### Example workflows

#### Debug a workflow that spans multiple providers

Connect a local CLI or daemon provider, then add a remote or browser provider into the same workspace. This is useful when a task crosses boundaries, like:

- a browser checkout flow talking to a local test backend
- a desktop helper app coordinating with a local daemon
- a multi-window or multi-tab system where one provider alone is incomplete

The chat panel can reason across the connected providers, while the tree viewer lets you verify what each one is publishing.

#### Compare what the AI sees before and after a change

Keep the tree viewer open, trigger a user action in the app, and confirm that the active provider tree changes the way you expect. If the AI gives a surprising answer, the desktop app is a good place to check whether the issue is bad prompting or bad provider state.

## Chrome extension

Use the extension for in-browser providers and for testing the desktop bridge.

```bash
cd apps/extension
bun install
bun run build
```

Then open `chrome://extensions`, enable Developer mode, and load the `apps/extension` directory as an unpacked extension.

### Before you chat

The extension popup controls `Active`, `Chat overlay`, and `Desktop bridge`, but model profiles live on the extension settings page:

1. Open the popup.
2. Click `LLM Settings ->`.
3. Add or edit a profile for Ollama, OpenAI, OpenRouter, or Gemini.
4. Open the in-page overlay and choose the active profile and model.

The extension starts with a default local Ollama profile at `http://localhost:11434` using `qwen2.5:14b`.

### What it actually does

- detects SLOP-native providers running in the current page
- opens an on-page chat overlay with a floating launcher
- lets you inspect the current tree from inside the page
- can scan a page with the accessibility adapter when no native provider is present
- can relay browser providers into the desktop app through the bridge

### Example workflows

#### Test a SLOP-enabled SPA in place

Open your local app in Chrome, load the extension, and visit the page. If the page already exposes a SLOP provider, the extension detects it and the chat overlay can:

- show the provider name and connection status
- display the formatted tree
- route model tool calls to the affordances on that page

This is the quickest way to test the browser experience without leaving the app you are building.

#### Use the accessibility adapter on a non-SLOP page

If a page is not SLOP-native, open the extension popup and click **Scan this page**. The extension builds a temporary provider from accessibility data, which is useful for:

- evaluating how the chat UI behaves on third-party pages
- testing the browser consumer before your app has a native provider
- comparing a native provider against a fallback accessibility-derived view

#### Bridge a browser provider into desktop

Run the desktop app, enable the extension's desktop bridge, and open a SLOP-enabled page. The browser provider is announced to the desktop workspace automatically, so you can inspect browser state alongside local sockets and remote WebSocket providers.

The bridge endpoint is `ws://127.0.0.1:9339/slop-bridge`.

## Building a custom consumer

Use the SDKs when you want the same primitives the shipped consumers use, but in your own tool.

Common cases:

- CI smoke tests that connect, query the tree, and invoke one safe affordance
- local debugging scripts that log snapshots and patches
- agent backends that convert affordances into model tools
- custom inspectors for a specific product or workflow

The repo already includes this pattern in `examples/cli/test-harness.ts`, which exercises the example providers over the real wire protocol instead of calling implementation internals directly.

### TypeScript

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
const { id, snapshot } = await consumer.subscribe("/", -1);

consumer.on("patch", (subscriptionId, ops, version) => {
  console.log("patch", subscriptionId, version, ops);
});

console.log(hello.provider.name);
console.log(formatTree(snapshot));

await consumer.invoke("/tasks", "add", {
  title: "Ship docs",
  due: "tomorrow",
  tags: "docs",
});

console.log(consumer.getTree(id));
```

### Go

```go
transport := &slop.WSClientTransport{URL: "ws://localhost:3000/slop"}
consumer := slop.NewConsumer(transport)

hello, _ := consumer.Connect(context.Background())
subID, snapshot, _ := consumer.Subscribe(context.Background(), "/", -1)

fmt.Println(hello["provider"], subID, snapshot.ID)
```

The same pattern works well for a headless regression check: connect, subscribe or query, invoke one known action, and fail fast if the tree shape or result changes unexpectedly.

## Next Steps

- [Consumer package API](/api/consumer)
- [Desktop app docs](/desktop/install)
- [Chrome extension docs](/extension/install)
