---
title: "Desktop App"
description: "Build and use the SLOP desktop app"
---
The SLOP desktop app is a multi-provider consumer workspace. It connects to local providers discovered from `~/.slop/providers/`, remote WebSocket providers, and browser providers bridged from the extension.

## Release builds

Tagged releases attach desktop binaries to the project’s GitHub Releases. If you are developing locally or need the latest main-branch version, build from source.

## Build from source

Requires Bun, Rust, and the Tauri toolchain:

```bash
git clone https://github.com/devteapot/slop.git
cd slop/apps/desktop
bun install
bun run dev
```

## What the app does

- groups providers into workspaces
- offers AI chat across multiple connected providers
- auto-discovers local Unix socket providers
- connects to WebSocket providers manually
- shows browser providers through the extension bridge
- includes a live tree viewer for inspection and debugging

## Browser bridge

The desktop app listens on `ws://localhost:9339`. When the Chrome extension enables the desktop bridge, browser providers are announced to the desktop app automatically.

## Related pages

- [Consumer guide](/guides/consumer)
- [Chrome extension docs](/extension/install)
