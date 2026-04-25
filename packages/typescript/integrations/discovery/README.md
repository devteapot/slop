# @slop-ai/discovery

Provider discovery, bridge, and agent-tool helpers for SLOP consumers.

Use this package when an integration needs to find local SLOP providers, connect to browser-tab providers through the extension bridge, expose lifecycle tools such as `list_apps`, or derive dynamic tools from provider affordances.

See the [Discovery & Bridge guide](https://docs.slopai.dev/sdk/discovery/) for the full behavior contract.

## Install

```bash
bun add @slop-ai/discovery
```

Install `@slop-ai/consumer` directly only when your integration also uses the lower-level protocol client APIs.

## Entrypoints

```ts
import { createBridgeClient, createBridgeServer, BridgeRelayTransport } from "@slop-ai/discovery";
import { createDiscoveryService } from "@slop-ai/discovery/service";
import { createToolHandlers, createDynamicTools } from "@slop-ai/discovery/tools";
```

| Entrypoint | Purpose |
| --- | --- |
| `@slop-ai/discovery` | Bridge primitives and shared descriptor types. |
| `@slop-ai/discovery/service` | Provider scanning, bridge startup, connection orchestration, idle cleanup, and reconnect handling. |
| `@slop-ai/discovery/tools` | Host-agnostic lifecycle handlers and affordance-to-tool mapping. |
| `@slop-ai/discovery/anthropic-agent-sdk` | Optional Anthropic Agent SDK helpers. |

## Discovery service

```ts
import { createDiscoveryService } from "@slop-ai/discovery/service";

const discovery = createDiscoveryService({
  autoConnect: false,
});

discovery.start();

const providers = discovery.getDiscovered();
console.log(providers.map((provider) => provider.name));

const provider = await discovery.ensureConnected("todo-app");
const tree = provider?.consumer.getTree(provider.subscriptionId);

console.log(tree);

discovery.stop();
```

By default, the service scans `~/.slop/providers/` and `/tmp/slop/providers/`, watches for descriptor changes, and tries to use the extension bridge at `ws://127.0.0.1:9339/slop-bridge`. If no bridge is already running, the first discovery service hosts one.

## Tool helpers

```ts
import { createDiscoveryService } from "@slop-ai/discovery/service";
import { createDynamicTools, createToolHandlers } from "@slop-ai/discovery/tools";

const discovery = createDiscoveryService({ autoConnect: true });
const handlers = createToolHandlers(discovery);

discovery.start();

await handlers.listApps();
await handlers.connectApp({ app: "todo-app" });

const dynamicTools = createDynamicTools(discovery);
const tool = dynamicTools.tools[0];
const target = tool ? dynamicTools.resolve(tool.name) : null;

console.log(tool, target);
```

`createToolHandlers()` returns lifecycle handlers for host integrations. `createDynamicTools()` converts connected provider affordances into namespaced tool definitions that can be registered by hosts with runtime tool catalogs.

## CLI

The package also ships `slop-discovery`, an MCP stdio server that exposes discovery lifecycle tools:

```bash
slop-discovery
```

## Documentation

- Discovery & Bridge guide: https://docs.slopai.dev/sdk/discovery/
- Consumer guide: https://docs.slopai.dev/guides/consumer/
- API index: https://docs.slopai.dev/api/
