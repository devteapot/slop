# 10 — Desktop Integration

A desktop application can serve as a unified SLOP client — connecting to web apps, local apps, and CLI tools from a single interface. This document covers how a desktop client discovers and connects to SLOP providers, including web apps running in the browser.

## Direct connections (no browser extension needed)

Most SLOP transports are directly accessible from a desktop process. No browser extension is required.

### Unix socket

Local applications expose SLOP providers on Unix sockets (e.g., `/tmp/slop/my-app.sock`). The desktop app connects the same way the CLI demo-agent does — open the socket, speak the SLOP protocol.

```
Desktop app ←—Unix socket—→ Local SLOP provider
```

Discovery: read descriptor files from `~/.slop/providers/` and `/tmp/slop/providers/`. See [03 — Transport & Discovery](./03-transport.md#local-discovery).

### WebSocket

Server-backed web apps expose a SLOP WebSocket endpoint (e.g., `ws://localhost:3737/slop`). The desktop app connects directly — a WebSocket is a network socket, not a browser API. Any process can open one.

```
Desktop app ←—WebSocket—→ Web app server (/slop endpoint)
```

Discovery options:
- **Local discovery files** — if the web app registers in `~/.slop/providers/`, the desktop app finds it automatically
- **HTTP probe** — `GET http://localhost:3737/.well-known/slop` returns the provider descriptor with the WebSocket URL
- **User-configured** — the user pastes a URL into the desktop app

This covers the majority of web apps. If the app has a server and exposes `/slop`, the desktop app connects without any browser involvement.

### stdio

The desktop app can spawn CLI tools as child processes and communicate via stdin/stdout (NDJSON). This is identical to how the existing `StdioClientTransport` works.

```
Desktop app ←—stdio—→ CLI tool (spawned)
```

## The browser gap: in-page providers (SPAs)

Client-only SPAs run their SLOP provider inside the browser page using `postMessage`. There is no network endpoint — the provider exists only in JavaScript memory within the page context. A desktop app cannot `postMessage` into a browser tab.

This is the **one case** where a bridge is needed. Three approaches:

### Approach 1: Extension as WebSocket relay

The browser extension connects to the in-page provider via postMessage and re-exposes it as a local WebSocket server. The desktop app connects to that WebSocket. The extension becomes a transparent relay — no chat UI, no LLM calls.

```
Browser page ←—postMessage—→ Extension ←—local WebSocket—→ Desktop app
  (SLOP provider)               (relay)                     (SLOP consumer)
```

**How it works:**
1. The extension discovers an in-page SLOP provider via `<meta name="slop" content="postmessage">`
2. It starts a local WebSocket server (e.g., `ws://localhost:9339/slop`) via the extension's background service worker
3. The desktop app connects to that WebSocket
4. The extension relays messages bidirectionally: WebSocket ↔ postMessage

**Pros:**
- Clean separation — extension is a dumb pipe, desktop app is the smart client
- The extension is lightweight and doesn't need LLM integration
- Works with any desktop app that speaks SLOP over WebSocket

**Cons:**
- Requires the extension to be installed
- MV3 service worker lifecycle makes persistent WebSocket servers tricky (needs keepalive)
- Extra hop adds latency (small, but nonzero)

### Approach 2: Chrome DevTools Protocol (CDP)

The desktop app connects to Chrome's remote debugging interface and injects postMessage calls directly into the page. No extension needed.

```
Browser page ←—postMessage—→ CDP injected script ←—CDP WebSocket—→ Desktop app
  (SLOP provider)                                                    (SLOP consumer)
```

**How it works:**
1. Chrome is launched with `--remote-debugging-port=9222`
2. The desktop app connects to `ws://localhost:9222` (CDP)
3. It uses `Runtime.evaluate` to inject a script that:
   - Discovers the SLOP meta tag
   - Sends/receives postMessage on behalf of the desktop app
   - Relays SLOP messages back over CDP
4. The desktop app speaks SLOP through this injected relay

**Pros:**
- No extension required
- Full control over the page
- Can potentially also access the DOM/accessibility tree for Tier 2/3 adapters

**Cons:**
- Requires Chrome to be launched with a debug flag (not the default)
- Security implications — CDP access grants full page control
- More complex implementation
- Some enterprise environments block debug ports

### Approach 3: Native messaging

Chrome's [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) API lets an extension communicate with a local native application via stdio. The desktop app registers as a native messaging host, and the extension pipes SLOP messages through `chrome.runtime.connectNative()`.

```
Browser page ←—postMessage—→ Extension ←—native messaging (stdio)—→ Desktop app
  (SLOP provider)               (bridge)                              (SLOP consumer)
```

**How it works:**
1. The desktop app installs a native messaging host manifest (a JSON file in a well-known Chrome directory)
2. The extension connects to the native host via `chrome.runtime.connectNative("slop")`
3. SLOP messages are relayed over the native messaging channel (stdin/stdout, NDJSON)
4. The desktop app processes them as a regular SLOP consumer

**Pros:**
- Official Chrome API, well-supported
- Reliable connection (not affected by service worker lifecycle)
- Secure — only the registered native app can receive messages
- Used by established apps (1Password, KeePassXC, etc.)

**Cons:**
- Requires the extension to be installed
- Requires a native messaging host manifest to be registered on the system
- stdio communication adds serialization overhead (negligible for SLOP message volumes)

## Recommended architecture: local WebSocket bridge

The three approaches above (WebSocket relay, CDP, native messaging) are all viable for the SPA bridge case. For simplicity and zero-setup operation, the recommended approach is a **local WebSocket bridge** — the desktop runs a WebSocket server at a well-known port, the extension auto-connects.

```
Local apps ──Unix socket──┐
                          │
CLI tools ──stdio─────────┤
                          ├── Desktop app (unified provider list)
Server-backed web apps ───┤        ↑
  (direct WebSocket)      │        │ ws://localhost:9339/slop-bridge
                          │        ↓
SPAs ──postMessage──Extension (relay only for SPAs)
```

### How the bridge works

The desktop app starts a WebSocket server at `ws://localhost:9339/slop-bridge`. The extension's background worker connects to it on startup (and reconnects if the desktop restarts).

The bridge serves **two purposes**:

1. **Discovery** — the extension announces ALL web providers it finds to the desktop
2. **Relay** — only for SPAs, where the desktop can't reach the in-page provider directly

### Bridge protocol

Extension → Desktop:

```jsonc
// Provider discovered on a page
{
  "type": "provider-available",
  "tabId": 42,
  "provider": {
    "id": "kanban-board",
    "name": "Kanban Board",
    "transport": "ws",                          // or "postmessage"
    "url": "ws://localhost:3737/slop"            // only for ws transport
  }
}

// Provider gone (tab closed, navigated away)
{ "type": "provider-unavailable", "tabId": 42 }

// SLOP message relayed from an SPA page
{ "type": "slop-relay", "tabId": 42, "message": { "type": "snapshot", ... } }
```

Desktop → Extension:

```jsonc
// SLOP message to relay to an SPA page
{ "type": "slop-relay", "tabId": 42, "message": { "type": "subscribe", ... } }
```

### Connection strategy per provider type

When the desktop receives a `provider-available` announcement, it decides how to connect based on the transport:

| Provider transport | Desktop connection | Extension role |
|---|---|---|
| `"ws"` | Desktop connects **directly** to the WebSocket URL | Discovery only — not in the data path |
| `"postmessage"` | Desktop sends SLOP messages **through the bridge relay** | Discovery + relay — extension pipes messages to/from the page |

For server-backed web apps, the extension's only job is telling the desktop "this WebSocket URL exists." The desktop opens its own WebSocket connection — faster, more reliable, no middleman.

For SPAs, the extension is the relay — it receives SLOP messages from the desktop over the bridge, forwards them to the page via postMessage, and relays responses back.

### Zero-setup operation

- If the desktop is not running, the extension works standalone (its own chat UI)
- If the extension is not installed, the desktop works standalone (local + manual WebSocket providers)
- When both are running, the extension tries `ws://localhost:9339/slop-bridge` on startup — if it connects, discovery and relay are active. No configuration, no manifest files, no installation steps.
- The extension retries the bridge connection periodically (every 30 seconds) so it auto-reconnects when the desktop launches.

### Implementation size

The bridge is lightweight:
- Desktop: WebSocket server + provider announcement handler (~50 lines)
- Extension: auto-connect to bridge + announcement sender + relay handler (~60 lines)
- Bridge protocol: 3 message types

## Discovery unification

The desktop app aggregates providers from all discovery sources into a single list:

1. **Local filesystem** — scan `~/.slop/providers/` for descriptor files (Unix socket, stdio providers)
2. **HTTP probe** — check `/.well-known/slop` on known/configured hosts (WebSocket providers)
3. **Extension bridge** — the extension announces discovered web providers via the local WebSocket bridge
4. **Manual** — user-configured WebSocket URLs

Each discovered provider appears in the desktop's sidebar regardless of how it was found. The desktop connects using the appropriate transport — Unix socket, direct WebSocket, or bridge relay — transparently.

```
Desktop sidebar:
  LOCAL
    ├── my-cli-tool (Unix socket, from ~/.slop/providers/)
    └── background-service (Unix socket, from ~/.slop/providers/)
  WEB (from extension bridge)
    ├── Kanban Board (WebSocket — direct connection)
    ├── Notes App (postMessage — via extension relay)
    └── Gmail (accessibility tree — via extension relay)
```
