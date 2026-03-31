---
title: "Adapters"
---

Most apps won't implement SLOP natively from day one. Adapters bridge existing applications to the SLOP protocol by translating their existing state representations into SLOP state trees.

## Adapter architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   App        │────>│   Adapter    │────>│   Consumer   │
│  (existing)  │     │  (bridge)    │     │   (AI)       │
└──────────────┘     └──────────────┘     └──────────────┘
       │                     │
   App's native       SLOP state tree
   state/API          + affordances
```

An adapter:
1. Reads state from the app through whatever interface the app already exposes
2. Maps it to a SLOP state tree
3. Runs a SLOP provider (socket, stdio, etc.)
4. Detects changes and emits patches
5. Translates affordance invocations back into app-native actions

## Web apps

Web integration is covered in detail in [Web Integration](./web.md). It defines three tiers:

1. **SLOP-native** — the app implements SLOP directly (server-side via WebSocket, or client-side via postMessage)
2. **Framework adapter** — an extension hooks into React/Vue/Svelte state
3. **Accessibility adapter** — an extension reads the browser's accessibility tree

The remaining sections of this document cover non-web adapters.

## Terminal apps — Terminal adapter

Terminal applications render to a character grid. An adapter can parse this into structure.

### Source: Terminal state

- **Screen buffer** — the current character grid (via `tmux capture-pane`, PTY interception, or terminal emulator API)
- **Cursor position** — maps to `meta.focus`
- **ANSI colors/styles** — can indicate semantic roles (red = error, bold = heading)

### Approach: Heuristic parsing

For well-known TUI frameworks (ncurses, blessed, ink, bubbletea), the adapter can recognize common patterns:

| Pattern | SLOP mapping |
|---|---|
| Bordered box | `type: "group"` |
| Menu with highlighted item | `type: "collection"` with `selected` property |
| Text input with cursor | `type: "field"` |
| Status bar | `type: "status"` |
| Tab bar | `type: "group"` with children |

### Approach: Native integration

TUI frameworks could export SLOP state directly. For example, a Bubbletea middleware:

```go
// Go — Bubbletea SLOP middleware
func SLOPMiddleware(model tea.Model) SLOPProvider {
    return &slopBubbletea{
        model: model,
        // Expose Model state as SLOP tree
        // Map Msg handling to affordances
    }
}
```

## Native apps — OS accessibility adapter

Desktop apps on macOS, Windows, and Linux expose accessibility trees through OS APIs.

### macOS (AXUIElement)

```
AXUIElement           →  SLOP node
──────────────────────────────────
AXWindow              →  type: "view"
AXTable               →  type: "collection"
AXRow                 →  type: "item"
AXTextField           →  type: "field"
AXButton              →  type: "control"
AXStaticText          →  properties.label
AXValue               →  properties.value
AXFocused             →  meta.focus
```

### Windows (UI Automation)

Same concept with `IUIAutomationElement` → SLOP nodes.

### Linux (AT-SPI)

Same concept with `Atspi.Accessible` → SLOP nodes.

### Adapter process

A standalone adapter process that:
1. Enumerates accessible windows
2. Registers as a SLOP provider for each
3. Polls or subscribes to AX change notifications
4. Translates to SLOP patches

## CLI tools — Stdio adapter

The simplest case. CLI tools that want to be SLOP-aware just print structured state to stdout.

### Wrapping existing commands

A generic wrapper that captures stdout and maps it:

```bash
# Wrapper: run a command, capture output, expose as SLOP
slop-wrap -- git status
```

The wrapper:
1. Runs the command
2. Parses output (plain text, JSON, or known formats)
3. Exposes it as a SLOP tree on stdout (NDJSON)

### Native SLOP output

CLI tools can add a `--slop` flag that outputs SLOP state instead of human-readable text:

```bash
$ my-tool --slop
{"type":"snapshot","version":1,"tree":{"id":"root","type":"root","children":[...]}}
```

This is the lightest possible integration — a few extra lines of code in the tool.

## Adapter guidelines

1. **Semantic mapping over literal translation.** Don't create a SLOP node for every DOM element. Group, summarize, and create meaningful nodes.

2. **Stable IDs are critical.** Use the app's own IDs where possible (database IDs, element IDs). Fall back to content hashes or path-based IDs. Avoid index-based IDs (they break on reorder).

3. **Compute salience.** The adapter is in the best position to judge what matters — focused element gets high salience, off-screen elements get low salience, errors get critical salience.

4. **Debounce aggressively.** UI updates happen at 60fps. SLOP patches should happen at 1–10/second max. Batch changes.

5. **Respect depth requests.** Don't send the full tree when the consumer asked for depth 1. This is the primary mechanism for managing token cost.

6. **Map native actions to affordances.** Every clickable button, every submittable form, every keyboard shortcut — these are affordances. Expose them.
