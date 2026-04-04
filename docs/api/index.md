# Package Overview

This page maps every published package in the repo to its primary use case and the matching guide.

## TypeScript packages

| Package | Use it for | Install | Docs |
| --- | --- | --- | --- |
| `@slop-ai/core` | shared types, helpers, tree utilities | `bun add @slop-ai/core` | [API](/api/core) |
| `@slop-ai/client` | browser and SPA providers | `bun add @slop-ai/client` | [API](/api/client), [Vanilla guide](/guides/vanilla) |
| `@slop-ai/react` | React hooks | `bun add @slop-ai/client @slop-ai/react` | [API](/api/react), [Guide](/guides/react) |
| `@slop-ai/vue` | Vue composables | `bun add @slop-ai/client @slop-ai/vue` | [API](/api/vue), [Guide](/guides/vue) |
| `@slop-ai/solid` | Solid primitives | `bun add @slop-ai/client @slop-ai/solid` | [API](/api/solid), [Guide](/guides/solid) |
| `@slop-ai/angular` | Angular signal integration | `bun add @slop-ai/client @slop-ai/angular` | [API](/api/angular), [Guide](/guides/angular) |
| `@slop-ai/svelte` | Svelte 5 rune integration | `bun add @slop-ai/client @slop-ai/svelte` | [API](/api/svelte), [Guide](/guides/svelte) |
| `@slop-ai/server` | server, desktop, and CLI providers | `bun add @slop-ai/server` | [API](/api/server), [Guide](/guides/server-apps) |
| `@slop-ai/consumer` | custom agents, inspectors, and bridges | `bun add @slop-ai/consumer` | [API](/api/consumer), [Guide](/guides/consumer) |
| `@slop-ai/tanstack-start` | TanStack Start full-stack adapter | `bun add @slop-ai/server @slop-ai/tanstack-start` | [API](/api/tanstack-start), [Guide](/guides/tanstack-start) |
| `@slop-ai/openclaw-plugin` | OpenClaw integration | `bun add @slop-ai/openclaw-plugin` | [API](./openclaw-plugin.md), [Guide](../guides/advanced/openclaw.md) |

## Other SDKs

| Package | Use it for | Install | Docs |
| --- | --- | --- | --- |
| `slop-ai` for Python | FastAPI, services, local tools, Python consumers | `pip install slop-ai[websocket]` | [API](/api/python), [Guide](/guides/python) |
| `slop-ai` for Go | `net/http` services, daemons, CLI tools, Go consumers | `go get github.com/devteapot/slop/packages/go/slop-ai` | [API](/api/go), [Guide](/guides/go) |
| `slop-ai` for Rust | Axum apps, services, daemons, CLI tools, Rust consumers | `cargo add slop-ai` | [API](/api/rust), [Guide](/guides/rust) |

## Which package should I start with?

- Building a browser app: start with [`@slop-ai/client`](/api/client) and add your framework adapter if one exists.
- Building a server-backed or native app: start with [`@slop-ai/server`](/api/server).
- Building a full-stack TanStack Start app: use [`@slop-ai/tanstack-start`](/api/tanstack-start).
- Building an agent, bridge, or test harness: use [`@slop-ai/consumer`](/api/consumer).
- Building an AI tool integration with auto-discovery: use the [discovery layer](/sdk/discovery) on top of the consumer SDK.
- Working outside TypeScript: use the language-specific SDK pages for [Python](/api/python), [Go](/api/go), or [Rust](/api/rust).
