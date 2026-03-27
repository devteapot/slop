# 07 — Adapters

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

## Web apps — Browser adapter

The richest near-term opportunity. A browser extension or injected script can bridge any web app to SLOP.

### Source: Accessibility tree

The browser already computes an accessibility tree (AX tree) for every page. This is the best generic source:

```
AX tree node          →  SLOP node
─────────────────────────────────────
role: "main"          →  type: "view"
role: "list"          →  type: "collection"
role: "listitem"      →  type: "item"
role: "textbox"       →  type: "field"
role: "button"        →  type: "control"
name: "Send"          →  properties.label: "Send"
value: "hello"        →  properties.value: "hello"
states: ["focused"]   →  meta.focus: true
```

**Affordances from ARIA:**
- `role: "button"` → affordance: `{ action: "click" }`
- `role: "textbox"` → affordance: `{ action: "fill", params: { value: "string" } }`
- `role: "link"` → affordance: `{ action: "follow" }`
- `aria-expanded: true` → affordance: `{ action: "collapse" }`

### Source: Framework state (richer)

For apps using React, Vue, Svelte, etc., an adapter can hook into the component tree or state store:

```
React component tree  →  SLOP semantic tree
──────────────────────────────────────────────
<InboxView>           →  type: "view", id: "inbox"
<MessageList>         →  type: "collection"
<MessageRow>          →  type: "item" + properties from props/state
  props.unread        →  properties.unread
  onClick             →  affordance: { action: "open" }
```

**Redux/Zustand/MobX stores** are even better — they're already structured state:

```js
// Redux store
{
  messages: { byId: { ... }, allIds: [...] },
  ui: { selectedId: "msg-42", composing: false }
}
// Maps almost directly to a SLOP tree
```

### Change detection

- **MutationObserver** on DOM for accessibility tree changes
- **Store subscriptions** for framework state
- **Debounce** at 50–100ms to batch rapid changes into single patches

### Implementation sketch

```js
// Browser extension content script
class WebSLOPAdapter {
  constructor() {
    this.tree = null;
    this.version = 0;
    this.subscriptions = new Map();
  }

  // Build SLOP tree from accessibility tree
  buildTree(axNode, depth = 3) {
    return {
      id: axNode.id || generateId(axNode),
      type: mapRole(axNode.role),
      properties: {
        label: axNode.name,
        value: axNode.value,
        selected: axNode.states.includes("selected"),
        disabled: axNode.states.includes("disabled"),
      },
      affordances: deriveAffordances(axNode),
      children: depth > 0
        ? axNode.children.map(c => this.buildTree(c, depth - 1))
        : undefined,
      meta: {
        focus: axNode.states.includes("focused"),
        total_children: axNode.children.length,
      }
    };
  }

  // Detect changes and emit patches
  onMutation(mutations) {
    const newTree = this.buildTree(getAXRoot());
    const patches = diffTrees(this.tree, newTree);
    this.tree = newTree;
    this.version++;
    for (const [id, sub] of this.subscriptions) {
      this.send(sub.consumer, {
        type: "patch",
        subscription: id,
        version: this.version,
        ops: filterPatches(patches, sub.path, sub.depth)
      });
    }
  }
}
```

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
