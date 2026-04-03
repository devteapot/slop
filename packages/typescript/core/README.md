# `@slop-ai/core`

Core types, descriptor helpers, and tree utilities for SLOP.

Use this package when you need the shared low-level building blocks. If you are instrumenting an app directly, you will usually pair it with [`@slop-ai/client`](https://docs.slopai.dev/api/client) or [`@slop-ai/server`](https://docs.slopai.dev/api/server).

## Install

```bash
bun add @slop-ai/core
```

## What it includes

- `pick`, `omit`, and `action` for building descriptors
- shared wire and descriptor types such as `NodeDescriptor`, `SlopNode`, and `Affordance`
- tree assembly and diff helpers for advanced integrations
- scaling helpers such as `prepareTree`, `truncateTree`, and `autoCompact`

## Example

```ts
import { action, pick } from "@slop-ai/core";

const taskNode = {
  type: "item",
  props: pick(task, ["title", "done", "priority"]),
  actions: {
    toggle: action(() => toggleTask(task.id)),
    rename: action({ title: "string" }, ({ title }) => renameTask(task.id, title)),
  },
};
```

## Documentation

- API reference: https://docs.slopai.dev/api/core
- Browser provider: https://docs.slopai.dev/api/client
- Server provider: https://docs.slopai.dev/api/server
- Protocol spec: https://docs.slopai.dev/spec/core/overview
