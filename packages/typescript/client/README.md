# `@slop-ai/client`

Browser-side SLOP provider for SPAs and in-page integrations.

`@slop-ai/client` creates a provider that publishes state from a browser app. It uses `postMessage` discovery by default and can optionally open a WebSocket transport for desktop bridging or custom setups.

## Install

```bash
bun add @slop-ai/client
```

## Quick start

```ts
import { createSlop } from "@slop-ai/client";

export const slop = createSlop({
  id: "notes-app",
  name: "Notes App",
});

slop.register("notes", {
  type: "collection",
  props: { count: notes.length },
  items: notes.map((note) => ({
    id: note.id,
    props: { title: note.title, pinned: note.pinned },
  })),
});
```

## Optional transports

```ts
const slop = createSlop({
  id: "notes-app",
  name: "Notes App",
  transports: ["postmessage", "websocket"],
  websocketUrl: true,
});
```

`websocketUrl: true` uses the default desktop bridge URL, and `websocketUrl: "ws://..."` lets you point at a custom endpoint.

## Works with framework adapters

- React: `@slop-ai/react`
- Vue: `@slop-ai/vue`
- Solid: `@slop-ai/solid`
- Angular: `@slop-ai/angular`
- Svelte: `@slop-ai/svelte`

## Documentation

- API reference: https://docs.slopai.dev/api/client
- Vanilla guide: https://docs.slopai.dev/guides/vanilla
- React guide: https://docs.slopai.dev/guides/react
- Consumer SDK: https://docs.slopai.dev/api/consumer
