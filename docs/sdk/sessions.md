# Sessions & Multi-User

SLOP's core protocol describes a single provider serving a single state tree. This works for SPAs (each browser tab is its own provider), CLI tools, and single-user desktop apps. But server-backed web apps serve many users simultaneously, and each user sees different state — different data, different permissions, different active views.

This document defines how providers handle multiple users and how the protocol, SDK, and meta-framework adapters support session-scoped state.

## The problem

A naive server-side setup creates one provider shared by all consumers:

```ts
const slop = createSlopServer({ id: "my-app", name: "My App" });
slop.register("todos", () => ({
  type: "collection",
  items: getTodos().map(...)   // Whose todos?
}));
attachSlop(slop, httpServer);  // All WebSocket consumers share this instance
```

This breaks in three ways:

### 1. One tree, many users

The state tree is singular. If User A is on the Inbox view and User B is on Settings, the tree can only represent one of them. The `context` node might show `{ user: "alice" }`, but there is no mechanism for a second consumer to see `{ user: "bob" }` from the same provider.

### 2. Global refresh

`refresh()` re-evaluates all descriptor functions and broadcasts patches to every connected consumer. There is no way to say "refresh User A's session only." A mutation to Alice's data triggers a re-evaluation and broadcast cycle that also hits Bob's connection — and since the descriptor functions have no user context, they return the same tree for both.

### 3. Stateless descriptors

Descriptor functions are zero-argument closures. They have no way to know which user's state they should return:

```ts
slop.register("todos", () => ({
  items: getTodos().map(...)   // Global — not scoped to a user
}));
```

Similarly, affordance handlers receive action parameters but no caller identity:

```ts
actions: {
  delete: { handler: () => deleteTodo(t.id) }  // Who is deleting? No session context.
}
```

## Where multi-user is and isn't a problem

| Architecture | Multi-user? | Why |
|---|---|---|
| **Client-only SPA** | Not a problem | Each browser tab runs its own provider instance. The tree is inherently single-user. |
| **Server, single-user** (CLI, Electron, local dev) | Not a problem | One user, one provider, one tree. |
| **Server, multi-user** (production web app) | **Problem** | Multiple users connect to the same server. Each needs their own tree. |

For SPAs: each tab creates its own `createSlop()` instance, assembles its own tree from local state, and communicates with its own extension consumer via `postMessage`. Two users on two browsers are two completely isolated loops. Nothing in the protocol needs to change.

## Two approaches

There are two ways to solve multi-user on the server:

1. **Provider-per-session** — each user gets their own `SlopServer` instance with its own tree, diff engine, and subscription state.
2. **Session-scoped trees** — one provider, one engine, but descriptor functions receive a session parameter and the engine renders different trees per consumer.

Both approaches are valid. This section analyzes their tradeoffs.

### Provider-per-session

Each authenticated connection gets a fully independent `SlopServer`:

```
10,000 users = 10,000 SlopServer instances

Each instance:
  - Tree object (nodes, properties, affordances)
  - Descriptor registry (closures)
  - Diff engine state (previous tree snapshot)
  - Subscription tracker (active subscriptions, filters)
  - WebSocket connection(s)
```

**Advantages:**

- **Simple.** Each instance is self-contained. No shared mutable state, no session routing logic.
- **Fault-isolated.** A descriptor function that throws crashes one session, not all of them.
- **Easy cleanup.** `slop.stop()` tears down one session completely.

**Limitations:**

- **Memory scales linearly.** Each instance carries its own tree, diff state, and engine overhead. At 10,000 sessions with a moderately complex tree, memory usage is significant.
- **Shared mutations are expensive.** If an admin deletes a shared resource, the app must: find all affected sessions (needs a reverse index), call `refresh()` on each, and each independently re-evaluates descriptors → diffs → serializes → sends patches. That's O(affected_sessions) × (evaluate + diff + serialize), with no sharing of work across sessions that would produce identical patches.
- **Tab-closed problem.** In the fullstack model where the consumer connects directly to the server, the provider must stay alive even when the browser tab closes (the AI consumer may still be connected). This means `SlopServer` instances accumulate — you can't clean them up based on browser disconnection alone. Every session that's ever been opened stays resident until the consumer disconnects or the session expires.
- **Duplicated work.** 8,000 users viewing the same page with the same structure (different data) means 8,000 independent diff engines doing structurally identical work.

**Scaling profile:**

| Users | Memory | CPU on shared mutation | Verdict |
|---|---|---|---|
| 100 | Fine | Fine | Good fit |
| 1,000 | Noticeable | O(1000) refresh loops | Workable |
| 10,000 | Heavy | Expensive | Strain |
| 100,000 | Requires horizontal sharding | Impractical single-node | Not viable |

### Session-scoped trees (recommended)

One provider instance with session-aware descriptors. The engine maintains per-session state (cached tree, subscriptions) but shares its infrastructure (tree assembly, diffing, transport management).

```
10,000 users = 1 SlopServer + 10,000 session contexts

The engine:
  - Shared descriptor registry (functions of session → descriptor)
  - Per-session: rendered tree cache + subscription state + session context
  - Shared: diff algorithm, tree assembly, transport management
```

**Advantages:**

- **Memory-efficient.** The heavy machinery (engine, diff algorithm, descriptor registry, transport layer) exists once. Per-session overhead is just the cached tree and a lightweight session context object.
- **Shared mutations are natural.** The engine already knows which sessions subscribe to what. A mutation triggers re-evaluation of the affected descriptor for each relevant session — but the engine orchestrates this in one pass, not N independent loops.
- **Tab-closed resilience.** Session contexts are lightweight — keeping 100,000 of them in memory is trivial compared to 100,000 full `SlopServer` instances. The consumer stays connected to the server; the session context stays alive; only the `ui` subtree disappears when the tab closes.
- **Batch optimization.** When many sessions share the same tree structure (same page, different data), the engine can batch structural diffs and only vary the data. Provider-per-session can't do this.

**Limitations:**

- **More complex internals.** The engine must track per-session state, route patches to the right connections, and handle session lifecycle — all within a single process.
- **Shared fault domain.** A bug in the engine affects all sessions. There's no physical isolation between users — isolation is logical.
- **Descriptor API change.** Descriptors become `(session) => descriptor` instead of `() => descriptor`. The developer always has to think about session context.

**Scaling profile:**

| Users | Memory | CPU on shared mutation | Verdict |
|---|---|---|---|
| 100 | Minimal | Minimal | Good fit |
| 1,000 | Low | Batchable | Good fit |
| 10,000 | Moderate | Optimizable | Good fit |
| 100,000 | Manageable with eviction | Needs work partitioning | Viable |

### Why session-scoped trees are the default recommendation

The fullstack model — where the server keeps the merged tree and the consumer connects directly — requires the provider to stay alive independently of the browser tab. This is the deciding factor:

```
Consumer ──WebSocket──► Server (owns the full tree)
                           ├── todos (server data)
                           ├── settings (server data)
                           └── ui (mounted from browser — absent when tab closed)

Tab open:   consumer sees todos + settings + ui
Tab closed: consumer sees todos + settings, can still invoke server-side actions
```

With provider-per-session, keeping providers alive means orphaned `SlopServer` instances sitting in memory — full engine, full tree, full diff state — for every session, indefinitely. With session-scoped trees, the same scenario costs one lightweight session context per user.

The analogy is how web servers work: one Express/Hono app, many requests, each request gets its own `req.user`. You don't spin up a new Express instance per user. The engine is shared; the context varies.

### When to use provider-per-session instead

Provider-per-session is still the right choice when:

- **Low session count** (< 100 concurrent). The simplicity wins over the efficiency.
- **Fault isolation matters more than memory.** Multi-tenant SaaS where one tenant's buggy data must not crash others.
- **Sessions are short-lived.** If users connect, do one thing, and disconnect, the cleanup overhead is minimal.
- **You need horizontal sharding anyway.** At massive scale, each shard runs a subset of sessions as independent providers. The per-session model maps cleanly onto this.

## Scaling characteristics

The primary concern with session-scoped trees is memory: the engine holds a rendered tree per active session. This section provides concrete numbers.

### What's stored per session

The engine maintains two copies of the rendered tree per active session — the current tree (for snapshots) and the previous tree (for diffing). Inactive sessions (no consumer connected) only store a lightweight session context.

```
Active session:    rendered tree + previous tree + subscription state ≈ 2× tree size
Inactive session:  session context (userId, role, permissions)        ≈ 1KB
```

### How big is a rendered tree?

A SLOP node averages ~500 bytes (id, type, properties, meta, affordances). But a well-implemented provider never renders the full application state — the spec's scaling features keep per-session trees small:

| Scaling feature | Effect |
|---|---|
| View-scoped trees | Only the active view is expanded; inactive views are stubs (~20 bytes each) |
| Windowed collections | 25 items inline, not 1,000 |
| Lazy subtrees | Message bodies, attachments, threads — `null` until queried |
| Salience filtering | Low-salience nodes excluded from subscriptions entirely |

A typical provider renders 50–200 nodes per session. That's **25–100KB** per rendered tree, or **50–200KB** with the diff snapshot.

### Memory projections

Assumes 200KB per active session (100-node tree × 2 for diffing), 1KB per inactive session:

| Total sessions | Active (%) | Memory (trees) | Memory (contexts) | Total |
|---|---|---|---|---|
| 1,000 | 100% | 200MB | — | ~200MB |
| 10,000 | 30% | 600MB | 7MB | ~600MB |
| 50,000 | 15% | 1.5GB | 42MB | ~1.5GB |
| 100,000 | 10% | 2GB | 90MB | ~2.1GB |

These numbers are for the SLOP tree layer only — the application's own data (database, caches) is separate and shared.

### The main scaling lever: eviction

The single most impactful optimization is **not holding rendered trees for idle sessions**. If no consumer is connected, the session context stays (it's 1KB) but the rendered tree is evicted. When a consumer reconnects, the engine re-evaluates descriptors and sends a fresh snapshot.

This means memory scales with **concurrent active consumers**, not total sessions. An app with 100,000 registered users but 3,000 concurrent AI consumers uses ~600MB for SLOP trees — well within a single server's capacity.

### CPU: the other axis

Memory is rarely the bottleneck. CPU matters when a shared mutation (admin action, broadcast update) triggers re-evaluation across many sessions:

```
Shared mutation → evaluate descriptor for each affected session → diff each → send patches
```

This is O(affected_sessions) regardless of approach — provider-per-session does the same work in a loop. Session-scoped trees can batch this more efficiently (shared descriptor registry, no per-instance overhead), but the per-session evaluate+diff cost is inherent.

Mitigations:
- **Scope refreshes narrowly.** `refresh({ where: s => s.orgId === "acme" })` only touches affected sessions, not all of them.
- **Debounce shared mutations.** Batch rapid changes (50–100ms) into one refresh cycle.
- **Offload to workers.** Descriptor evaluation and tree diffing are pure functions — they can run in worker threads.

### Comparison with provider-per-session

Provider-per-session has the same per-session tree cost, plus ~50–100KB of engine overhead per instance (diff engine, subscription tracker, event system, descriptor registry). At 10,000 active sessions, that's 500MB–1GB of additional overhead compared to session-scoped trees.

| | Session-scoped trees | Provider-per-session |
|---|---|---|
| Per active session | ~200KB (tree only) | ~300KB (tree + engine) |
| Per inactive session | ~1KB (context) | ~100KB (idle engine) or 0 (destroyed) |
| 10,000 active | ~2GB | ~3GB |
| Shared mutation CPU | Same | Same |
| Engine memory | O(1) | O(N) |

The difference is meaningful but not dramatic. The dominant cost in both approaches is the rendered trees — and the spec's scaling features (view scoping, windowing, lazy subtrees) are what keep those small. **A provider that uses scaling features well will scale fine with either approach. A provider that dumps 10,000 nodes per session will struggle with both.**

## Session-scoped trees: design

### Session-aware descriptors

Descriptor functions receive a session context parameter:

```ts
const slop = createSlopServer({ id: "my-app", name: "My App" });

slop.register("todos", (session) => ({
  type: "collection",
  items: getTodosForUser(session.userId).map(t => ({
    id: t.id,
    props: { title: t.title, done: t.done },
    actions: session.permissions.includes("write")
      ? {
          toggle: () => toggleTodo(t.id),
          delete: { handler: () => deleteTodo(t.id), dangerous: true },
        }
      : {},  // read-only users get no actions
  })),
}));

slop.register("context", (session) => ({
  type: "context",
  props: {
    user: session.userName,
    role: session.role,
    permissions: session.permissions,
  },
}));
```

The session parameter is injected by the engine at evaluation time. Each consumer's subscription triggers evaluation with that consumer's session context.

### Connection authentication

Authentication happens at the WebSocket upgrade — before any SLOP messages flow:

```ts
attachSlop(slop, httpServer, {
  path: "/slop",

  // Called on WebSocket upgrade — return a session or null to reject
  authenticate: (req) => {
    const token = parseCookie(req.headers.cookie)?.session;
    return token ? getSession(token) : null;
  },
});
```

The engine associates the authenticated session with the connection. All subsequent descriptor evaluations for that connection use its session context.

### Session-scoped refresh

`refresh()` accepts an optional session filter:

```ts
// Refresh one session (e.g., after a user-specific mutation)
slop.refresh({ sessionId: "abc123" });

// Refresh all sessions for a user (e.g., user has multiple tabs)
slop.refresh({ userId: "alice" });

// Refresh all sessions (e.g., after a global config change)
slop.refresh();

// Refresh sessions matching a predicate (e.g., after a shared resource changes)
slop.refresh({ where: (session) => session.orgId === "acme" });
```

When scoped, only the matching sessions re-evaluate their descriptors, diff, and receive patches. Unaffected sessions are untouched.

### Session context in affordance handlers

Handlers receive the invoking session as a second argument:

```ts
slop.register("todos", (session) => ({
  type: "collection",
  actions: {
    add: {
      params: { title: "string" },
      handler: ({ title }, session) => {
        addTodo({ title, userId: session.userId });
        // Auto-refresh for this session after handler completes
      },
    },
  },
  items: getTodosForUser(session.userId).map(...),
}));
```

The handler knows who the caller is without protocol changes — the engine injects the session that owns the connection the `invoke` arrived on.

### Multiple connections per session

A single user may have multiple tabs open, each with its own WebSocket connection. These share the same session context and see the same server-side tree.

Each tab's browser UI provider mounts its own `ui` subtree:

```
Session "alice":
  ├── todos (server data — shared across tabs)
  ├── settings (server data — shared across tabs)
  ├── ui/tab-1 (route: /inbox, from Tab 1's browser UI provider)
  └── ui/tab-2 (route: /settings, from Tab 2's browser UI provider)
```

When a tab closes, its `ui/tab-N` subtree is removed. The server data and other tabs' UI subtrees remain. The AI consumer still sees the full server-side tree and can continue interacting.

### Session lifecycle

```
WebSocket connect
    │
    ▼
authenticate(req) → Session
    │
    ▼
Engine associates session with connection
    │
    ▼
Normal SLOP flow: hello → subscribe → snapshot → patch...
    │
    ▼
WebSocket disconnect
    │
    ▼
If no more connections for this session:
    → keep session context alive (lightweight — just a data object)
    → evict after session expiry (tied to auth session TTL)
    → or evict after idle timeout (no consumer reconnection within N minutes)
```

Because session contexts are lightweight (a plain object with user ID, role, permissions), they can stay in memory far longer than a full `SlopServer` instance would.

### Session context eviction

For apps with many sessions, the engine should support eviction:

- **TTL-based** — evict session contexts when the auth session expires.
- **Idle-based** — evict when no consumer has been connected for a threshold period.
- **LRU** — cap the number of active session contexts and evict least-recently-used when the cap is reached. Evicted sessions re-authenticate and re-subscribe on next connection.

Eviction only removes the cached tree and session context. The user's data in the database is unaffected. Reconnecting triggers a fresh descriptor evaluation and snapshot.

## Provider-per-session: design

For apps that choose provider-per-session, the pattern is straightforward:

### Session provider factory

```ts
function createSessionProvider(session: Session) {
  const slop = createSlopServer({
    id: `my-app-${session.id}`,
    name: "My App",
  });

  // Descriptors close over the session — zero-argument, session is in the closure
  slop.register("todos", () => ({
    type: "collection",
    items: getTodosForUser(session.userId).map(t => ({
      id: t.id,
      props: { title: t.title, done: t.done },
      actions: session.permissions.includes("write")
        ? { toggle: () => toggleTodo(t.id) }
        : {},
    })),
  }));

  return slop;
}
```

### Session routing

```ts
const sessions = new Map<string, SlopServer>();

server.on("upgrade", (req, socket, head) => {
  const session = authenticate(req);
  if (!session) { socket.destroy(); return; }

  let slop = sessions.get(session.id);
  if (!slop) {
    slop = createSessionProvider(session);
    sessions.set(session.id, slop);
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    slop.handleConnection(ws);
  });
});
```

### `attachSlopWithSessions` convenience

A wrapper that handles the session-to-provider map:

```ts
import { attachSlopWithSessions } from "@slop-ai/server/node";

attachSlopWithSessions(httpServer, {
  authenticate: (req) => {
    const token = parseCookie(req.headers.cookie)?.session;
    return token ? getSession(token) : null;
  },
  createProvider: (session) => createSessionProvider(session),
  sessionTimeout: 60_000,  // grace period before cleanup
  path: "/slop",
});
```

### Cross-session refresh

Shared mutations require iterating affected sessions:

```ts
app.delete("/api/shared-resource/:id", (req, res) => {
  const affectedUserIds = deleteSharedResource(req.params.id);

  for (const [sessionId, slop] of sessions) {
    if (affectedUserIds.includes(getSessionUser(sessionId))) {
      slop.refresh();
    }
  }

  res.json({ ok: true });
});
```

This is the main ergonomic cost of provider-per-session — the app must maintain a reverse index from users to sessions, and fan out refreshes manually.

## Meta-framework adapters

Meta-framework adapters handle session scoping automatically. The developer writes descriptor registrations; the adapter handles session management.

### Session-scoped trees (default)

```ts
// server/utils/slop.ts — Nuxt example
import { defineSlopConfig } from "@slop-ai/nuxt/server";

export default defineSlopConfig({
  id: "my-app",
  name: "My App",

  // Descriptors receive session context
  setup(slop) {
    slop.register("todos", (session) => ({
      type: "collection",
      items: getTodosForUser(session.userId).map(...),
    }));
  },
});
```

### Provider-per-session (opt-in)

```ts
export default defineSlopConfig({
  id: "my-app",
  name: "My App",
  sessionMode: "provider-per-session",

  // setup is called once per session with a fresh SlopServer
  setup(slop, session) {
    slop.register("todos", () => ({
      type: "collection",
      items: getTodosForUser(session.userId).map(...),
    }));
  },
});
```

The only difference from the developer's perspective: with session-scoped trees, descriptors receive `session` as a parameter. With provider-per-session, `session` is available in the `setup` closure and descriptors are zero-argument.

## Protocol implications

The core SLOP protocol requires **no changes** for multi-user support. Sessions are an application concern, not a protocol concern:

| Protocol layer | Multi-user impact |
|---|---|
| **Messages** | Unchanged — `subscribe`, `snapshot`, `patch`, `invoke` work per-connection |
| **State tree** | Unchanged — the tree structure is the same whether rendered for one user or many |
| **Transport** | Unchanged — each WebSocket connection is already independent |
| **Discovery** | Minor — `/.well-known/slop` describes the app, not a specific session. Authentication happens at WebSocket upgrade. |

The `hello` message may optionally include session metadata:

```jsonc
{
  "type": "hello",
  "provider": {
    "id": "my-app",
    "name": "My App",
    "slop_version": "0.1",
    "capabilities": ["state", "patches", "affordances"],
    "session": {                    // Optional, informational
      "user": "alice",
      "role": "admin"
    }
  }
}
```

This is not a protocol requirement — it's a convenience for consumers that want to display or log session context. The `session` field is opaque to the protocol.

## AI consumer behavior

From the consumer's perspective, nothing changes. It connects to a WebSocket endpoint, receives a `hello`, subscribes, and gets a tree. Whether that tree is session-scoped or global is invisible — the consumer just sees its state tree.

When the browser tab closes, the consumer retains access to the server-side tree. It can still invoke server-side affordances (`add_todo`, `toggle`, `delete`). Only browser-specific state (DOM-level UI, client-side filters, compose drafts) disappears — that state was in the `ui` subtree mounted from the browser, which unmounts when the tab closes.

The consumer should not assume it can see other users' state. If it needs to act on behalf of multiple users, it needs multiple connections (one per session), each authenticated separately.

## Summary

| Concern | Session-scoped trees | Provider-per-session |
|---|---|---|
| **Memory at scale** | O(1) engine + O(N) lightweight contexts | O(N) full engine instances |
| **Shared mutations** | Engine orchestrates in one pass | App fans out N independent refreshes |
| **Tab-closed resilience** | Trivial — contexts are lightweight | Expensive — full instances stay alive |
| **Fault isolation** | Logical (shared process) | Physical (independent instances) |
| **Descriptor API** | `(session) => descriptor` | `() => descriptor` (session in closure) |
| **Complexity** | Engine is more complex | Engine is simple, app routing is more complex |
| **Best for** | Production multi-user apps | Small-scale, high-isolation, short-lived sessions |

## Security considerations

- **Session isolation is mandatory.** A consumer connected to Alice's session must never see Bob's tree or invoke Bob's affordances. With session-scoped trees, the engine enforces this by evaluating descriptors with the correct session context per connection. With provider-per-session, isolation is structural — separate instances share nothing.

- **Authentication happens at the transport level.** The WebSocket upgrade request carries credentials (cookies, tokens). SLOP messages do not include authentication — by the time messages flow, the connection is already authenticated and bound to a session.

- **Affordance handlers must validate authorization.** In both approaches, the handler knows the session (via parameter or closure). But affordances appearing in the tree is not sufficient authorization — the handler should still validate that the mutation is permitted, just as any API endpoint would. An affordance being visible is a UX signal, not a security boundary.

- **Cross-session mutations require explicit design.** When a mutation affects other users (shared resources, admin actions), the app must explicitly trigger refresh for affected sessions. Implicit cross-session state leakage is a security risk. With session-scoped trees, use `refresh({ where: ... })`. With provider-per-session, iterate affected instances.
