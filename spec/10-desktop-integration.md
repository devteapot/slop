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

## Workspaces

The desktop app organizes connections into **workspaces** — displayed as tabs across the top of the window. Each workspace has its own set of connected providers and a unified chat thread.

A workspace is defined by:
- A name (user-editable)
- A list of `providerIds` — the providers currently connected in that workspace
- A chat history — one conversation thread per workspace

The AI in each workspace sees a **merged state tree** from all connected providers. It can read state and invoke actions across providers in a single turn. Switching workspaces disconnects the old workspace's providers and connects the new ones. This keeps conversations scoped — a "Work" workspace with Jira + Slack won't bleed state into a "Personal" workspace with a todo app.

### Workspace-scoped connections

Each workspace maintains its own `providerIds` array. When the user activates a workspace:

1. Providers from the previously active workspace are disconnected (subscriptions torn down)
2. Providers in the newly active workspace's `providerIds` are connected (subscriptions started)
3. The chat thread switches to the new workspace's conversation

Explicitly disconnecting a provider removes it from the active workspace's `providerIds`. Pinned providers (see Sidebar groups) auto-reconnect when their workspace is activated.

## Unified multi-provider chat

Each workspace has a single conversation thread. The AI sees a merged tree from all connected providers — it can read a Kanban board's columns and a Slack channel's messages in the same context.

### Tool name disambiguation

When multiple providers are connected, tool names are prefixed with the provider name to avoid collisions:

```
kanban-board__invoke__columns__add_card
slack__invoke__channels__send_message
```

The format is `{provider}__invoke__{path}__{action}`. In **single-provider mode** (only one provider connected), the prefix is dropped for cleaner names:

```
invoke__columns__add_card
```

### Gemini compatibility

Gemini's function calling API has strict constraints on tool names (alphanumeric + underscores, limited length). The desktop app maps tools to indexed names when using Gemini:

```
tool_0  →  kanban-board__invoke__columns__add_card
tool_1  →  slack__invoke__channels__send_message
```

The mapping is maintained for the duration of the conversation. When Gemini calls `tool_0`, the desktop maps it back to the original tool name and routes the invocation to the correct provider.

## Sidebar groups

The desktop sidebar organizes providers into three groups:

### Pinned

Per-workspace, persisted to disk. These are providers the user has explicitly pinned to a workspace. Pinned providers auto-reconnect when the workspace is activated — the desktop re-establishes subscriptions without user interaction.

### Local Apps

Discovered via `~/.slop/providers/` and `/tmp/slop/providers/`. These appear automatically as local apps register or deregister. See [03 — Transport & Discovery](./03-transport.md#local-discovery).

### Browser Tabs

Populated from the extension bridge. Each browser tab with SLOP providers appears here, grouped under a collapsible "Browser Tabs" header. Tabs come and go as the user navigates — the extension announces arrivals and departures over the bridge.

A single browser tab can have **multiple providers** — fullstack apps (TanStack Start, Next.js, Nuxt) have a server provider (WebSocket, direct) and a client UI provider (postMessage, via bridge relay). Each provider appears as a separate entry grouped by tab:

```
Workspace: "Project Alpha"
  PINNED
    ├── Kanban Board (ws — direct)
    └── Slack (ws — direct)
  LOCAL APPS
    ├── my-cli-tool (sock)
    └── background-service (sock)
  BROWSER TABS
    ├── Project Tracker          ws    ← server data (direct WebSocket)
    ├── Project Tracker          pm    ← client UI (postMessage relay)
    ├── Notes App                pm    ← SPA (postMessage relay)
    └── Gmail                    pm    ← accessibility tree (relay)
```

**Connection behavior on tab close:**
- **WebSocket providers** stay connected — the desktop connected directly, no bridge dependency. The entry persists until manually disconnected.
- **postMessage providers** lose their bridge relay when the tab closes. The connection drops and the entry is removed (unless pinned, in which case it persists for later reconnect).

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
// Provider discovered on a page (one message per provider)
// Fullstack apps send TWO announcements — one for server (ws), one for client (pm)
{
  "type": "provider-available",
  "tabId": 42,
  "provider": {
    "id": "tab-42-ws",                           // unique per provider, not per tab
    "name": "Project Tracker",
    "transport": "ws",
    "url": "ws://localhost:3000/slop"
  }
}
{
  "type": "provider-available",
  "tabId": 42,
  "provider": {
    "id": "tab-42-postmessage",
    "name": "Project Tracker",
    "transport": "postmessage"                   // no url — uses bridge relay
  }
}

// Provider gone (tab closed, navigated away) — removes ALL providers for the tab
{ "type": "provider-unavailable", "tabId": 42 }

// SLOP message relayed from a postMessage provider
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
- The extension retries the bridge connection every **5 seconds** when the desktop is unavailable, so it auto-reconnects quickly when the desktop launches.

### Provider discovery resilience

The extension bridge handles several edge cases that arise from MV3's service worker lifecycle and network interruptions:

**Retry on disconnect.** When the bridge WebSocket closes (desktop quit, network blip), the extension retries every 5 seconds until it reconnects.

**Re-announce on reconnect.** When the bridge reconnects, the extension re-announces all known providers. This ensures the desktop's provider list is complete even if the extension accumulated discoveries while the desktop was down.

**Active tab query on restart.** MV3 service workers can be terminated by Chrome at any time. When the service worker restarts, in-memory state (which tabs have SLOP providers) is lost. On restart, the extension sends a `get-slop-status` message to all tabs to rediscover providers, then announces them over the bridge. This handles the cold-start case where the bridge is already connected but the extension's memory was wiped.

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

Each discovered provider appears in the desktop's sidebar under the appropriate group (Pinned, Local Apps, or Browser Tabs — see Sidebar groups above). The desktop connects using the appropriate transport — Unix socket, direct WebSocket, or bridge relay — transparently.

## Roadmap: SLOP-enabled desktop app

The desktop app itself can become a SLOP provider. Its own state — the workspace list, connected providers, chat history, settings — is observable via the same protocol it consumes. Another SLOP client (a CLI agent, a second desktop instance, a web dashboard) could connect to the desktop app and read or manipulate its state.

This turns the desktop from a leaf consumer into a node in the SLOP graph — consuming providers below it and exposing its own state to consumers above it.
