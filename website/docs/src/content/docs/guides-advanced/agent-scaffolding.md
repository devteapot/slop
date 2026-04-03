---
title: "Agent-Assisted Integration"
---

Adding SLOP to an existing application is the main adoption barrier. The developer must understand the protocol, design a tree schema, write `register()` calls in the right components, and wire up action handlers. This is mechanical work that follows clear patterns — a perfect fit for AI assistance.

This document defines how an AI coding agent can automate SLOP integration, reducing the effort from hours to minutes.

## Two modes

### Scaffold mode: "Add SLOP to this project"

The agent analyzes the full codebase, generates the schema, and adds `register()` calls across all relevant components. Used once, at the start of SLOP adoption.

**Input:** A codebase (repo, directory, or set of files).

**Output:**
1. A typed schema file (`slop.ts`) declaring the tree structure
2. `useSlop()` calls added to existing components, near the state they describe
3. Action handlers wired to existing state mutations
4. `@slop-ai/client` and the appropriate framework adapter added to dependencies

### Incremental mode: "Add SLOP to this component"

The agent reads a single component or file and adds SLOP registration for the state it manages. Used when adding new features or onboarding new parts of the app.

**Input:** A file path or component name.

**Output:** A `useSlop()` call with the right path, descriptor, and action handlers, inserted near the component's state declarations.

## Analysis patterns

The agent maps framework-specific patterns to SLOP concepts. These patterns are deterministic — given a pattern, the mapping is unambiguous.

### State → Node type

| Pattern | SLOP type | Example |
|---|---|---|
| Array state (`useState<T[]>`) | `collection` with `items` | `const [todos, setTodos] = useState([])` → collection |
| Object state (`useState<T>`) | `group` with `props` | `const [user, setUser] = useState({})` → group |
| Primitive state (`useState<boolean>`) | `status` with `props` | `const [loading, setLoading] = useState(false)` → status |
| Form state (multiple related inputs) | `form` with field children | `const [email, setEmail] = useState("")` → form/field |
| Route/page component | `view` | `function InboxPage()` → view |
| Zustand store slice | `group` or `collection` | `const useTodoStore = create(...)` → collection |
| Redux slice | `group` or `collection` | `createSlice({ name: "todos" })` → collection |
| Vue `ref` / `reactive` | Same rules as above | `const todos = ref([])` → collection |
| Svelte `$state` | Same rules as above | `let todos = $state([])` → collection |

### Mutations → Actions

| Pattern | SLOP action | Example |
|---|---|---|
| `setItems(prev => [...prev, item])` | `create` with params | Adding to an array → `create` action |
| `setItems(prev => prev.filter(...))` | `delete` (dangerous) | Removing from array → `delete` action |
| `setItems(prev => prev.map(x => x.id === id ? {...x, ...updates} : x))` | `edit` with params | Updating an item → `edit` action |
| `setItem(prev => ({...prev, field: value}))` | `update` with params | Updating a field → `update` action |
| `setFlag(!flag)` | `toggle` | Boolean toggle → `toggle` action |
| Zustand `store.addTodo(title)` | `create` with params | Store method → action |
| Redux `dispatch(removeTodo(id))` | `delete` (dangerous) | Dispatch → action |
| Form `onSubmit` handler | `submit` with params | Form submission → `submit` action |
| `router.push(path)` | `navigate` with params | Navigation → `navigate` action |

### Component hierarchy → Tree paths

| Pattern | SLOP path | Example |
|---|---|---|
| Route definition | Top-level path segment | `/inbox` → `"inbox"` |
| Nested route | Nested path | `/inbox/compose` → `"inbox/compose"` |
| List component rendered by parent | Child path | `<MessageList>` inside `InboxView` → `"inbox/messages"` |
| Shared layout component | Context node | `<AppLayout>` → `"app"` context at root |

### Properties → Exposed props

Not all state should be exposed. The agent uses these heuristics:

**Expose:**
- Display values (titles, labels, counts, statuses)
- User-facing data (names, emails, dates)
- State flags that affect what the user sees (selected, expanded, loading, error)

**Don't expose:**
- Internal IDs used only for keying (`_internalKey`, `__typename`)
- Cached/derived data that duplicates other state
- UI-only state (animation progress, scroll position, hover state)
- Sensitive data (passwords, tokens, secrets)

## Scaffold workflow

### Step 1: Detect framework and state management

The agent scans `package.json` and imports to identify:
- **Framework:** React, Vue, Svelte, vanilla
- **State management:** useState, Zustand, Redux, Pinia, MobX, Jotai, Svelte stores
- **Router:** React Router, Next.js, Vue Router, SvelteKit
- **Existing SLOP integration:** check for `@slop-ai/client` in dependencies

### Step 2: Map routes to views

The agent reads the router configuration to build the top-level schema:

```ts
// From React Router routes:
// "/" → layout
// "/inbox" → InboxView
// "/inbox/compose" → ComposeView
// "/settings" → SettingsView
// "/settings/account" → AccountView

// Agent generates:
const schema = {
  inbox: {
    messages: "collection",
    compose: "form",
  },
  settings: {
    account: "group",
    notifications: "group",
  },
} as const;
```

### Step 3: Analyze components

For each component, the agent identifies:
1. What state it manages (useState, store subscriptions)
2. What mutations it performs (setState, dispatch, store methods)
3. Where it sits in the component hierarchy (which route, which parent)
4. What props it receives from parents

### Step 4: Generate registrations

The agent inserts `useSlop()` calls near the state declarations:

```tsx
// BEFORE (developer's existing code)
function MessageList() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  };

  const handleArchive = (id: string) => {
    setMessages(prev => prev.map(m =>
      m.id === id ? { ...m, archived: true } : m
    ));
  };

  return <div>{messages.map(m => <MessageRow key={m.id} message={m} />)}</div>;
}

// AFTER (agent adds SLOP integration)
function MessageList() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  };

  const handleArchive = (id: string) => {
    setMessages(prev => prev.map(m =>
      m.id === id ? { ...m, archived: true } : m
    ));
  };

  // --- SLOP integration ---
  useSlop(slop, "inbox/messages", () => ({
    type: "collection",
    props: { count: messages.length, selected: selectedId },
    items: messages.filter(m => !m.archived).map(m => ({
      id: m.id,
      props: { from: m.from, subject: m.subject, unread: m.unread, date: m.date },
      actions: {
        select: action(() => setSelectedId(m.id)),
        archive: action(() => handleArchive(m.id)),
        delete: action(() => handleDelete(m.id), { dangerous: true }),
      },
    })),
  }));

  return <div>{messages.map(m => <MessageRow key={m.id} message={m} />)}</div>;
}
```

The agent:
- Identified `messages` as an array state → `collection`
- Mapped `handleDelete` and `handleArchive` to actions
- Chose which `Message` fields to expose as props (from, subject, unread, date — not internal fields)
- Placed the `useSlop()` call after state declarations, before the return
- Used the correct path based on the component's position in the route tree
- Marked `delete` as dangerous

### Step 5: Generate schema file

The agent creates `slop.ts` at the project root:

```ts
import { createSlop } from "@slop-ai/client";

const schema = {
  inbox: {
    messages: "collection",
    compose: "form",
    unread: "status",
  },
  settings: {
    account: "group",
    notifications: "group",
  },
} as const;

export const slop = createSlop({
  id: "mail-app",
  name: "Mail App",
  schema,
});
```

### Step 6: Install dependencies

```bash
npm install @slop-ai/client @slop-ai/react   # or @slop-ai/vue, @slop-ai/svelte
```

## Incremental workflow

When adding SLOP to a single component:

### Step 1: Read the component

The agent reads the file, identifies state and mutations (same analysis as scaffold step 3).

### Step 2: Determine the path

The agent infers the path from:
- The component's location in the route tree
- Its parent component (if determinable from imports/usage)
- The existing schema (if one exists)
- Or asks the developer: "Where in the tree should this component register?"

### Step 3: Generate the `useSlop()` call

Same as scaffold step 4, but for a single component.

### Step 4: Update schema if needed

If the path doesn't exist in the schema, the agent adds it:

```ts
// Before
const schema = {
  inbox: {
    messages: "collection",
  },
} as const;

// After (agent adds "compose")
const schema = {
  inbox: {
    messages: "collection",
    compose: "form",        // ← added
  },
} as const;
```

## Delivery mechanisms

The agent can be delivered through multiple channels, reaching developers wherever they code:

### Claude Code command

A custom slash command that runs the agent:

```
> /add-slop                    # scaffold entire project
> /add-slop src/MessageList.tsx  # incremental, one component
```

The command reads the codebase context, runs the analysis, and applies changes through Claude Code's normal editing flow. The developer reviews the diff before accepting.

### CLI tool

A standalone CLI that wraps an LLM API call:

```bash
npx @slop-ai/init                           # scaffold
npx @slop-ai/init src/components/Chat.tsx    # incremental
```

The CLI:
1. Reads the project structure
2. Sends relevant files + the analysis prompt to an LLM API
3. Applies the generated changes
4. Runs `npm install` for dependencies

Works with any LLM (Ollama for local, OpenAI/Anthropic for remote). The developer chooses.

### IDE extension

A VS Code / JetBrains extension that adds:
- A code action: right-click a component → "Add SLOP"
- A command palette entry: "SLOP: Initialize project"
- Inline suggestions when writing components (detect state patterns, suggest `useSlop()`)

### Prompt-based (any AI assistant)

The analysis patterns documented in this spec are detailed enough that any AI coding assistant (Copilot, Cursor, Cline, Aider) can follow them. The developer pastes the prompt:

```
Read the SLOP agent scaffolding guide at https://docs.slopai.dev/guides-advanced/agent-scaffolding/
and add SLOP integration to this component: [paste component]
```

This is the lowest-friction option — no tool installation required.

## The system prompt

Regardless of delivery mechanism, the agent uses the same core prompt. The key sections:

```
You are adding SLOP integration to a web application.

SLOP (State Layer for Observable Programs) is a protocol that lets AI observe
and interact with application state. You are adding the developer-side
integration using the @slop-ai/client library.

Your job:
1. Analyze the component's state (useState, stores, etc.)
2. Map it to a SLOP node descriptor
3. Insert a useSlop() call near the state declarations
4. Wire action handlers to existing mutations

Rules:
- Place useSlop() after state declarations, before the return/render
- Use path-based IDs that reflect the component's position (e.g., "inbox/messages")
- Expose user-facing data as props, not internal state
- Map existing mutation functions to actions — don't create new logic
- Mark destructive actions (delete, clear) as dangerous: true
- Use the developer-friendly descriptor format (props, actions, items — not
  properties, affordances, children)
- Don't modify the component's JSX/template
- Don't add comments explaining SLOP — the code should be self-evident

Action mapping:
- Array push/concat → create action with params
- Array filter (remove) → delete action (dangerous)
- Array map (update item) → edit action with params
- Boolean toggle → toggle action
- Object spread (update fields) → update action with params
- Form onSubmit → submit action with params
- Router navigation → navigate action
```

## Quality checks

After the agent generates the integration, verify:

1. **Schema matches routes** — every page/view in the router has a corresponding top-level schema entry
2. **Paths are hierarchical** — child components register under their parent's path, not at the root
3. **No sensitive data exposed** — passwords, tokens, API keys are not in any `props`
4. **Actions are wired to real mutations** — every action handler calls an existing function, not new logic
5. **Dangerous flag on destructive actions** — delete, clear, remove actions are marked `dangerous: true`
6. **Items have stable IDs** — collection items use the entity's real ID, not array indices
7. **TypeScript compiles** — if using a typed schema, all paths resolve without errors

## Example: full scaffold output

Given a typical React + Zustand todo app, the agent generates:

**`slop.ts`** (new file):
```ts
import { createSlop } from "@slop-ai/client";

const schema = {
  todos: "collection",
  filters: "group",
  stats: "status",
} as const;

export const slop = createSlop({
  id: "todo-app",
  name: "Todo App",
  schema,
});
```

**`TodoList.tsx`** (modified — `useSlop` added):
```tsx
import { slop } from "./slop";
import { action, useSlop } from "@slop-ai/react";
import { useTodoStore } from "./store";

function TodoList() {
  const { todos, addTodo, toggleTodo, removeTodo } = useTodoStore();

  useSlop(slop, "todos", () => ({
    type: "collection",
    props: { count: todos.length },
    actions: {
      create: action({ title: "string" }, ({ title }) => addTodo(title)),
    },
    items: todos.map(todo => ({
      id: todo.id,
      props: { title: todo.title, done: todo.done, created: todo.createdAt },
      actions: {
        toggle: action(() => toggleTodo(todo.id)),
        delete: action(() => removeTodo(todo.id), { dangerous: true }),
      },
    })),
  }));

  return (
    <ul>
      {todos.map(todo => <TodoItem key={todo.id} todo={todo} />)}
    </ul>
  );
}
```

**`FilterBar.tsx`** (modified):
```tsx
import { slop } from "./slop";
import { action, useSlop } from "@slop-ai/react";

function FilterBar() {
  const [filter, setFilter] = useState<"all" | "active" | "done">("all");

  useSlop(slop, "filters", () => ({
    type: "group",
    props: { active: filter },
    actions: {
      set_filter: action(
        { value: "string" },
        ({ value }) => setFilter(value as "all" | "active" | "done"),
      ),
    },
  }));

  return <div>...</div>;
}
```

**`StatsBar.tsx`** (modified):
```tsx
import { slop } from "./slop";
import { useSlop } from "@slop-ai/react";

function StatsBar() {
  const { todos } = useTodoStore();
  const done = todos.filter(t => t.done).length;

  useSlop(slop, "stats", () => ({
    type: "status",
    props: { total: todos.length, done, remaining: todos.length - done },
  }));

  return <div>{todos.length} items, {done} done</div>;
}
```

**`package.json`** (modified — dependencies added):
```json
{
  "dependencies": {
    "@slop-ai/client": "^1.0.0",
    "@slop-ai/react": "^1.0.0"
  }
}
```

Total changes: 1 new file, 3 modified files, 2 new dependencies. Developer reviews the diff, adjusts prop selection or action naming if needed, and merges. The app is now SLOP-enabled.
