---
title: "Chrome Extension"
description: "Build and use the SLOP browser extension"
---
The Chrome extension discovers browser-based SLOP providers, opens an AI chat overlay, and can bridge those providers into the desktop app.

## Release builds

The release workflow produces a packaged extension artifact alongside tagged releases. For development and local testing, sideload the extension from source.

## Build from source

```bash
git clone https://github.com/devteapot/slop.git
cd slop/apps/extension
bun install
bun run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the `apps/extension` directory.

## What it does

- discovers browser providers via the SLOP discovery tag
- opens an AI chat overlay on supported pages
- relays browser providers to the desktop app when the bridge is enabled
- supports multiple LLM backends configured from the popup

## Desktop bridge

When enabled, the extension connects to the desktop bridge at `ws://localhost:9339` and re-announces active browser providers after reconnects or service-worker restarts.

## Related pages

- [Consumer guide](/guides/consumer)
- [Desktop app docs](/desktop/install)
- [Extension privacy policy](/extension/privacy)
