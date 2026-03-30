---
title: Chrome Extension
description: Install and use the SLOP browser extension
---

The SLOP Chrome extension discovers SLOP providers on web pages and provides an AI chat overlay. It also bridges browser providers to the desktop app.

## Install

### From Chrome Web Store

Coming soon.

### Sideload (developer mode)

1. Clone the repo:
   ```bash
   git clone https://github.com/devteapot/slop.git
   cd slop/extension
   bun install && bun run build.ts
   ```

2. Open `chrome://extensions` in Chrome

3. Enable **Developer mode** (top right)

4. Click **Load unpacked** and select the `extension/` directory

## Configure

Click the SLOP extension icon in the toolbar to access the popup:

- **Active** — master toggle. When off, no connections, no UI.
- **Chat overlay** — show/hide the floating chat panel on web pages.
- **Desktop bridge** — connect to the SLOP Desktop app (off by default).
- **LLM Settings** — configure AI providers (Ollama, OpenAI, OpenRouter, Gemini).

## Usage

1. Navigate to a SLOP-enabled web app
2. The extension auto-detects the `<meta name="slop">` tag
3. A blue chat button appears in the bottom-right corner
4. Click it to open the chat panel
5. Ask the AI about the app state or tell it to perform actions

## Supported LLM providers

| Provider | Endpoint | Notes |
|---|---|---|
| Ollama | `http://localhost:11434` | Local, free. Set `OLLAMA_ORIGINS=*` |
| OpenAI | `https://api.openai.com` | Requires API key |
| OpenRouter | `https://openrouter.ai/api` | Access to many models |
| Google Gemini | `https://generativelanguage.googleapis.com` | Requires API key |

## Desktop bridge resilience

The extension maintains a robust connection to the desktop app's WebSocket bridge:

- **Auto-retry** — reconnects on a 5-second interval when the bridge disconnects
- **Full re-announcement** — re-announces all active browser providers on reconnect so the desktop app's sidebar is immediately up to date
- **MV3 service worker recovery** — handles Chrome Manifest V3 service worker restarts by actively querying all tabs, ensuring no providers are lost when Chrome suspends and wakes the background script
