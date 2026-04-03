---
title: "Desktop App"
description: "Build and use the SLOP desktop app"
---
The SLOP desktop app is a multi-provider consumer workspace. It connects to local providers discovered from `~/.slop/providers/` and `/tmp/slop/providers/`, remote WebSocket providers, and browser providers bridged from the extension.

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

## First run

The app starts with a default workspace and a default local Ollama profile:

- provider: Ollama
- endpoint: `http://localhost:11434`
- model: `qwen2.5:14b`

If you want to use a hosted model instead:

1. Open `Settings`.
2. Add or edit a profile for OpenAI, OpenRouter, or Gemini.
3. Enter the endpoint and API key for that provider.
4. Use the top-bar selectors to choose the active profile and model.

Workspaces are the tabs across the top of the window. Each workspace keeps its own set of connected providers and its own chat history, so switching workspaces changes what the AI can currently see.

## Example workflows

### One workspace, multiple providers

Create a workspace for a single task flow, then connect the providers that matter for that flow. For example:

- a local Unix socket provider from a CLI or daemon
- a remote WebSocket provider from a web app or backend
- a browser provider relayed from the Chrome extension

This gives the chat panel a shared view of the system instead of forcing you to debug each provider in isolation.

### Inspect the tree while chatting

Open the tree viewer when you want to compare what the model says with what the provider is actually publishing. This is especially useful when a workflow seems "almost right" and you need to check whether the problem is:

- missing state in the provider
- a bad affordance schema
- the model reasoning over stale or incomplete context

## Browser bridge

The desktop app listens on `ws://127.0.0.1:9339/slop-bridge`. When the Chrome extension enables the desktop bridge, browser providers are announced to the desktop app automatically.

## Related pages

- [Consumer guide](/guides/consumer)
- [Chrome extension docs](/extension/install)
