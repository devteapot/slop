# Development & debugging

Practical guidance for building and debugging SLOP providers. These are recommendations for SDK implementers and app developers, not protocol requirements.

## Tree inspection

During development, the most common question is "what does my tree actually look like?" A provider should offer a way to print or inspect the current tree without requiring a connected consumer.

### SDK recommendation: `print_tree()` / `debug()`

Every SDK should expose a human-readable tree dump. This is the single most valuable debugging tool. It answers "did my registration produce the tree I expected?" without any external tooling.

**Python:**

```python
slop = SlopServer("my-app", "My App")
# ... register nodes ...
slop.refresh()
print(slop.print_tree())
```

**TypeScript (server):**

```ts
const slop = createSlopServer({ id: "my-app", name: "My App" });
// ... register nodes ...
console.log(slop.printTree());
```

**TypeScript (browser):**

```ts
const slop = createSlop({ id: "my-app", name: "My App" });
// ... register nodes via useSlop ...
console.log(slop.printTree());
```

Expected output format. The dump is compact and indented, and shows node types, properties, affordances, and metadata:

```
[root] my-app
  [collection] todos (count=3, done=1)  actions: {add(title: string)}
    [item] todo-1 (title="Buy milk", done=false)  actions: {toggle, delete}  salience=0.8
    [item] todo-2 (title="Read spec", done=true)  actions: {toggle, delete}  salience=0.3
    [item] todo-3 (title="Ship it", done=false)  actions: {toggle, delete}  salience=1.0
  [status] settings (theme="dark")  actions: {set_theme(theme: string)}
```

This format should match what `formatTree()` produces in the consumer SDK. That is the same output a consumer uses to present the tree to an LLM.

### Wire format inspection

For debugging protocol-level issues, SDKs should also support dumping the raw wire-format tree (JSON). This is useful when the compact format hides a problem, for example a `content_ref` that doesn't serialize correctly or a `meta` field with an unexpected shape.

```python
import json
print(json.dumps(slop.tree.to_dict(), indent=2))
```

```ts
console.log(JSON.stringify(slop.getTree(), null, 2));
```

## Schema validation

Affordance parameters use [JSON Schema](https://json-schema.org/). Invalid schemas don't cause protocol errors. They pass through to the consumer and may fail at LLM call time (some providers like Gemini are strict about schema completeness).

SDKs should **warn at registration time** when a parameter schema is likely invalid:

- `type: "array"` without `items` will fail on Gemini
- `type: "object"` without `properties` is ambiguous, so the LLM won't know what to pass
- Unknown `type` values are likely a typo

These are warnings, not errors. The protocol intentionally does not restrict schemas, but catching common mistakes early saves debugging time.

### Example warning

```
[slop] Warning: action "create" on "contacts" has param "tags" with type "array"
       but no "items" schema. Some LLM providers require "items" for array params.
```

## Message logging

For debugging connection and protocol issues, SDKs should support logging all messages sent and received. This should be opt-in (off by default) and configurable.

**Python:**

```python
import logging
logging.getLogger("slop").setLevel(logging.DEBUG)
```

**TypeScript:**

```ts
const slop = createSlopServer({ id: "my-app", name: "My App", debug: true });
```

When enabled, log each message with direction and type:

```
[slop] → hello {provider: {id: "my-app", name: "My App"}}
[slop] ← subscribe {id: "sub-1", path: "/", depth: -1}
[slop] → snapshot {id: "sub-1", version: 1, tree: {...}}
[slop] → patch {subscription: "sub-1", version: 2, ops: [{op: "replace", ...}]}
[slop] ← invoke {id: "inv-1", path: "/todos", action: "add", params: {title: "New"}}
[slop] → result {id: "inv-1", status: "ok"}
```

## Common debugging scenarios

### "The consumer doesn't see my node"

1. Call `printTree()` and check whether the node is in the tree
2. If not, check that `register()` was called and that `refresh()` was called after (server SDK)
3. If yes, check the consumer's subscription `depth` and `path`. A shallow subscription may not include deep nodes.

### "An action doesn't work"

1. Check the wire-format tree and verify the affordance is present with the correct `action` name and `params`
2. Enable message logging. Does the `invoke` arrive? Does the `result` indicate an error?
3. Check that the handler is attached to the correct path. A handler on `"todos/add"` won't fire for an invoke on `"/todos"` with action `"add"`.

### "Patches aren't being sent"

1. Verify `refresh()` is being called after the mutation (server SDK)
2. Check that the tree actually changed. If the descriptor function returns the same tree, no diff means no patch.
3. On the browser SDK, verify the component re-rendered (the `useSlop` hook re-registers on every render)

### "The tree is too large for the LLM context"

1. Use `meta.salience` to mark less-important nodes. Consumers can filter by `min_salience`.
2. Use windowed collections for large lists, exposing a `window` with a subset of items
3. Subscribe at a shallower `depth` to get the overview without the details
4. See [Scaling](../../spec/extensions/scaling.md) for depth truncation, compaction, and view-scoped trees
