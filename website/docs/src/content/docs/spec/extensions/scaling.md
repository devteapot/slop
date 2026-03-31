---
title: "Scaling"
---

SLOP is designed for AI consumption, and AI has a finite context window. A small todo app might fit entirely in context, but a large application — an email client, a project management tool, an IDE — has far more state than any AI can or should process at once.

This document defines patterns for structuring SLOP trees so they scale to large applications without overwhelming the consumer.

## The problem

A naive approach — dump the entire app state into one flat tree — fails at scale:

- An email inbox with 10,000 messages produces a tree too large for any context window
- A project management tool with hundreds of boards, each with dozens of cards, overwhelms the AI with irrelevant state
- Even if the tree fits, the AI wastes attention on state that has nothing to do with what the user is doing right now

The solution is not to limit what the app *can* expose, but to structure the tree so the AI reads **only what's relevant** by default and can reach everything else on demand.

## View-scoped trees

Large apps should structure their SLOP tree around **views** — pages, screens, or logical contexts that the user moves between. The current view is resolved in full detail. Other views are **stubs** — collapsed to an ID, type, and summary.

```
Root
├── [view] Dashboard        ← stub
│   meta: { summary: "3 charts, 2 alerts, last refreshed 5m ago" }
│
├── [view] Inbox            ← ACTIVE VIEW: full detail
│   meta: { focus: true }
│   properties: { label: "Inbox", unread: 12 }
│   children:
│     ├── [item] msg-1      ← full node with properties + affordances
│     ├── [item] msg-2
│     ├── ... (25 of 142 shown)
│   meta: { total_children: 142, window: [0, 25] }
│
├── [view] Settings         ← stub
│   meta: { summary: "Account, notifications, security, ..." }
│
└── [context] App           ← always present
    properties: { user: "alice", org: "acme" }
    affordances: [navigate, search, logout, compose]
```

Key properties of this pattern:

1. **The active view has `meta.focus: true`** — the AI immediately knows where the user is
2. **Inactive views are stubs** — they carry a `meta.summary` but no children or properties. This keeps the top-level tree small regardless of how many views the app has.
3. **App-level context is always present** — the `context` node carries global state (current user, account, theme) and global affordances (navigate, search, logout) that are available from any view.
4. **The active view uses windowing** — large collections within the view only include the visible portion, with `meta.total_children` and `meta.window` indicating the full extent.

### Navigation

When the user navigates from Inbox to Dashboard, the provider emits patches that:

1. Collapse the Inbox view to a stub (remove children, add summary)
2. Expand the Dashboard view with full detail (add children, properties)
3. Move `meta.focus` from Inbox to Dashboard

The AI's subscription receives these patches and its local mirror updates — the AI now sees Dashboard in detail and Inbox as a stub, without re-subscribing.

### Multiple subscription strategy

For large apps, the consumer can use multiple subscriptions at different scopes:

```jsonc
// Subscription 1: app overview — always active, shallow
{ "type": "subscribe", "id": "overview", "path": "/", "depth": 1 }

// Subscription 2: active view — full detail
{ "type": "subscribe", "id": "detail", "path": "/inbox", "depth": -1 }
```

When the user navigates, the consumer unsubscribes from the old view and subscribes to the new one. The overview subscription stays active and provides the full picture at a glance.

## Upward traversal

The AI should be able to discover actions and context beyond the current view by looking **upward** in the tree. This follows the principle of scope resolution — local first, then parent, then root.

### Affordance scope

Affordances live at the level they operate on:

| Scope | Example affordances | Where in tree |
|---|---|---|
| **Item** | edit, delete, toggle, move | On the item node |
| **Collection** | sort, filter, clear, select_all | On the collection node |
| **View** | refresh, change_layout, export | On the view node |
| **App** | navigate, search, compose, logout | On the root or context node |

When the AI needs to do something that isn't available on the current node, it looks upward:

1. Check the current item → no `navigate` affordance
2. Check the parent collection → no `navigate` affordance
3. Check the view → no `navigate` affordance
4. Check the root → `navigate` affordance found

This traversal is not a protocol mechanism — the tree is already available to the consumer. It's a **convention for how providers structure affordances** and how consumers search for them.

### Context inheritance

Some state applies to everything below it in the tree. Rather than repeating it on every node, place it on a shared ancestor:

```
Root
├── [context] App
│   properties: { user: "alice", permissions: ["read", "write"], locale: "en" }
│
├── [view] Inbox
│   ├── [item] msg-1
│   │   (inherits: user is alice, locale is en, permissions include write)
```

The AI can resolve context by walking from a node to the root, collecting `context` nodes along the way. This is analogous to variable scoping in programming — inner scopes inherit from outer scopes.

## Windowed collections

Large collections (hundreds or thousands of items) should never be fully inlined. The provider includes a **window** — the visible or most relevant slice — and metadata about the full set.

```jsonc
{
  "id": "inbox",
  "type": "collection",
  "properties": { "label": "Inbox", "total": 1420 },
  "meta": {
    "total_children": 1420,
    "window": [0, 25],
    "summary": "1420 messages, 12 unread. Most recent from bob@co.org (2 min ago)."
  },
  "children": [
    // Only 25 items — the currently visible window
  ]
}
```

### Requesting different windows

The consumer can query a different window:

```jsonc
{ "type": "query", "id": "q-1", "path": "/inbox", "depth": 1, "window": [100, 25] }
```

This returns items 100–124 without changing the active subscription. The AI uses this to "scroll" through large collections when needed.

### Summary over detail

The `meta.summary` field is critical for windowed collections. It gives the AI a high-level understanding of the full collection without loading all items:

- `"1420 messages, 12 unread, 3 flagged"`
- `"47 pull requests: 12 need review, 8 have conflicts"`
- `"230 products, filtered to 15 matching 'wireless'"`

A good summary lets the AI answer questions like "how many unread messages?" without loading 1420 nodes.

## Lazy subtrees

Some parts of the tree are expensive to compute or rarely needed. Providers can declare a subtree as **lazy** — present in the tree structure but not resolved until explicitly requested.

```jsonc
{
  "id": "msg-42",
  "type": "item",
  "properties": { "from": "alice", "subject": "Q3 Report", "unread": true },
  "children": null,
  "meta": {
    "total_children": 1,
    "summary": "1 attachment (Q3-report.pdf, 2.4 MB)"
  }
}
```

The message node declares it has children (the attachment) via `total_children`, but `children` is null. The consumer must explicitly query `/inbox/msg-42` at a deeper depth to load the attachment details.

This pattern is useful for:
- Message bodies and attachments (only load when the message is opened)
- File contents (only load when the file is selected)
- Nested comments/threads (only load when expanded)
- Historical data (only load when scrolled to)

## Salience-driven pruning

The attention system (see [Attention & Salience](../core/attention.md)) can drive tree pruning at scale. Nodes with low salience can be omitted entirely from subscriptions that filter by `min_salience`.

```jsonc
// Consumer subscribes with salience filter
{ "type": "subscribe", "id": "s1", "path": "/", "depth": 2, "filter": { "min_salience": 0.3 } }
```

The provider only includes nodes with salience ≥ 0.3. As salience changes (e.g., a notification fires, raising a node's salience to 1.0), the provider sends a patch adding the newly-relevant node.

This turns the AI's token budget into a dynamic filter — the AI sees what matters right now, and the boundary adjusts in real time.

**Ancestor retention:** Salience filtering is applied per-node without ancestor retention. If a parent node falls below the threshold, its entire subtree is excluded — even if some descendants have high salience. Providers should ensure that structurally important parent nodes (navigation groups, collection roots) carry salience at least as high as their most important children. This keeps the filtering logic simple and predictable; future protocol versions may introduce an ancestor-retention mode for trees where inherited salience matters.

### Provider salience guidelines for large apps

| Node state | Suggested salience |
|---|---|
| Active view, focused item | 0.9–1.0 |
| Active view, visible items | 0.5–0.8 |
| Active view, off-screen items | 0.1–0.3 |
| Inactive views | 0.0–0.1 |
| Error states, alerts | 1.0 (regardless of view) |
| Background processes | 0.0–0.2 (unless they finish or fail) |

## Recommended subscription patterns

### Small apps (< 100 nodes)

One subscription to root at unlimited depth. The full tree fits in context.

```jsonc
{ "type": "subscribe", "id": "s1", "path": "/", "depth": -1 }
```

### Medium apps (100–1,000 nodes)

One subscription to root at depth 2–3. Drill into specific paths with queries.

```jsonc
{ "type": "subscribe", "id": "s1", "path": "/", "depth": 2 }
// Then query for detail as needed:
{ "type": "query", "id": "q1", "path": "/inbox/msg-42", "depth": -1 }
```

### Large apps (1,000+ nodes)

Two subscriptions: overview + active view. Salience filtering. Windowed collections.

```jsonc
// Overview: always active, shallow, high salience threshold
{ "type": "subscribe", "id": "overview", "path": "/", "depth": 1,
  "filter": { "min_salience": 0.5 } }

// Active view: full detail, changes on navigation
{ "type": "subscribe", "id": "detail", "path": "/inbox", "depth": -1 }
```

## Developer API for scaling

The scaling patterns described above translate to specific features in the `@slop-ai/core` descriptor API. Developers don't need to construct SLOP protocol messages manually — the library handles it.

### Summaries

Every node can include a `summary` field in its descriptor. When the node is collapsed (beyond the consumer's depth limit), the summary replaces the full content.

```ts
slop.register("inbox", {
  type: "view",
  props: { label: "Inbox" },
  summary: "142 messages, 12 unread, 3 flagged",
  items: [...],
});
```

The summary is critical for AI comprehension. When the AI sees the tree at depth 1, it reads:

```
[view] Inbox — "142 messages, 12 unread, 3 flagged"
```

Instead of loading all 142 messages, the AI knows what's in the inbox from the summary alone. If it needs detail, it drills in.

**Guidelines for summaries:**
- Include counts, important states, and recency: `"47 PRs: 12 need review, 8 have conflicts"`
- Keep under 100 characters — it's a glance, not a paragraph
- Update the summary when state changes — stale summaries mislead the AI

### Windowed collections

For collections with many items (messages, rows, search results), expose only the **visible window** — the items the user can currently see.

```ts
slop.register("inbox/messages", {
  type: "collection",
  props: { count: allMessages.length },
  summary: `${allMessages.length} messages, ${unread} unread`,
  window: {
    items: visibleMessages.map(m => ({
      id: m.id,
      props: { from: m.from, subject: m.subject, unread: m.unread },
      actions: { archive: () => archive(m.id) },
    })),
    total: allMessages.length,
    offset: scrollPosition,
  },
});
```

When `window` is provided instead of `items`:
- The library sets `meta.total_children` to `window.total`
- The library sets `meta.window` to `[window.offset, items.length]`
- Only the windowed items appear as children in the tree
- The summary tells the AI what's in the full collection

The AI sees:
```
[collection] messages (count=500)
  summary: "500 messages, 12 unread"
  window: [0, 25] of 500
  [item] msg-1: "Q3 Report" from alice (unread)
  [item] msg-2: "Meeting notes" from bob
  ... (25 items shown)
```

### Depth control

The consumer controls how deep it wants the tree resolved. The `@slop-ai/core` client supports a `maxDepth` option that truncates the tree before sending to consumers:

```ts
const slop = createSlop({
  id: "my-app",
  name: "My App",
  maxDepth: 3,  // nodes beyond depth 3 become stubs with summaries
});
```

Nodes beyond `maxDepth` are replaced with stubs:
```json
{ "id": "thread-42", "type": "group", "meta": { "total_children": 15, "summary": "15 replies, 3 unread" } }
```

The consumer can query deeper on demand via the SLOP `query` message with a specific path and unlimited depth.

### Salience in descriptors

Mark node importance via `meta.salience` in the descriptor:

```ts
slop.register("notifications", {
  type: "collection",
  items: notifications.map(n => ({
    id: n.id,
    props: { message: n.message, time: n.time },
    meta: {
      salience: n.unread ? 1.0 : 0.2,
      urgency: n.priority === "high" ? "high" : "none",
    },
  })),
});
```

Consumers that subscribe with `min_salience` will only receive nodes above the threshold. This lets the AI focus its context window on what matters.

## Tree navigation

For large applications, the AI needs to **navigate** between different parts of the tree to find and act on the right state. The AI navigates the SLOP tree — not the UI. The developer maps tree navigation to whatever makes sense in their app: a route change, a tab switch, a section expand, or just loading more state.

The key principle: **the AI asks to see more of the tree, the app decides how to provide it.**

### The pattern

1. The **root** always shows all major sections as stubs with summaries
2. The root exposes `navigate` and/or `search` as affordances
3. The **active section** is registered with full detail (items, affordances, props)
4. **Inactive sections** are registered as stubs — just type + summary, no children
5. When the AI invokes `navigate`, the app fulfills it (route push, state load, etc.)
6. The tree rebuilds: the new section expands, the old one collapses to a stub

### Example: Amazon-scale app

```ts
// Root — always visible, provides navigation
slop.register("/", {
  type: "root",
  actions: {
    navigate: {
      params: { to: { type: "string", enum: ["shop", "cart", "orders", "profile"] } },
      handler: ({ to }) => router.push(`/${to}`),
    },
    search: {
      params: { query: "string" },
      handler: ({ query }) => router.push(`/search?q=${query}`),
    },
  },
});

// Active view — full detail (registered by the mounted page component)
useSlop(slop, "profile", {
  type: "view",
  props: { name: "Alice", email: "alice@example.com" },
  actions: { edit_name: { params: { name: "string" }, handler: ... } },
});

// Inactive views — stubs with summaries (registered by the app shell)
useSlop(slop, "cart", {
  type: "view",
  summary: "3 items, $127.49 — wireless mouse, USB-C cable, monitor stand",
});

useSlop(slop, "orders", {
  type: "view",
  summary: "12 recent orders, 1 in transit (arriving tomorrow)",
});

useSlop(slop, "shop", {
  type: "view",
  summary: "2.4M products across 30 categories",
});
```

The AI sees:

```
[root] Amazon
  actions: {navigate(to), search(query)}
  [view] Profile (name="Alice", email="alice@example.com")
    actions: {edit_name(name)}
  [view] Cart — "3 items, $127.49 — wireless mouse, USB-C cable, monitor stand"
  [view] Orders — "12 recent orders, 1 in transit (arriving tomorrow)"
  [view] Shop — "2.4M products across 30 categories"
```

When the user says "buy the wireless mouse in my cart":

1. AI reads cart summary → mentions "wireless mouse"
2. AI invokes `navigate({ to: "cart" })`
3. App navigates → profile component unmounts (becomes stub), cart component mounts (registers full state)
4. AI now sees cart items in detail → invokes `checkout` or `buy_now`

The AI navigated the tree by invoking an affordance. The protocol didn't change. The app decided how to respond.

### What makes navigation work

- **Summaries are the AI's preview.** `"3 items, $127.49"` tells the AI what's in the cart without loading all items. Good summaries are the single most important scaling feature.
- **The app controls granularity.** Navigation can mean "switch pages" or "expand a section" or "load the next 25 items." The protocol doesn't prescribe what happens.
- **Search is navigation.** For apps with millions of items (Amazon, a database), search is how the AI finds things. Expose it as a root affordance.
- **Stubs are cheap.** A collapsed view with a summary is ~50 bytes. An app with 100 sections still has a small root tree.

## Provider implementation guidelines

1. **Structure the tree around views.** Use the user's navigation as the primary organizing principle. Each route/page/screen is a view node.

2. **Keep the root small.** The root should have O(views) children, not O(items). Tens, not thousands.

3. **Summarize what you collapse.** Every stub and windowed collection should have a useful `meta.summary`. This is the AI's substitute for the full data.

4. **Window large collections.** Default to showing what the user can see. Include `total_children` and `window` so the AI knows there's more.

5. **Use lazy subtrees for detail.** Message bodies, file contents, thread replies — don't include them until the AI asks. Declare their existence via `total_children`.

6. **Place affordances at the right scope.** Item actions on items, collection actions on collections, app actions on root. The AI will find them by walking upward.

7. **Update salience with user context.** The focused item is 1.0. The notification that just fired is 1.0. The settings page the user hasn't visited in a week is 0.0.

8. **Patch, don't replace, on navigation.** When the user changes views, collapse the old view and expand the new one via patches. Don't send a full snapshot.
