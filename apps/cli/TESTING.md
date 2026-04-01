# Testing SLOP Applications

SLOP providers can be written in any language — Go, Python, Rust, TypeScript, or anything that speaks the protocol. The inspector's `provider.Manager` connects over the wire (Unix socket or WebSocket), which means it can test any provider without knowing or caring what language it's implemented in.

This document explores approaches for automated, declarative testing of SLOP applications.

## The problem

Right now, testing a SLOP provider means:

1. Start the provider manually
2. Connect with the desktop app or extension
3. Eyeball the tree — does it look right?
4. Click around to invoke affordances
5. Check if the state changed

This is slow, not reproducible, and doesn't run in CI. We need something like `curl` or Postman for SLOP — connect, assert state, invoke actions, check results, exit with a pass/fail code.

## Design principles

- **Language-agnostic.** Tests are declarative specs, not Go code. A Python SLOP app and a Rust SLOP app use the same test format.
- **Wire-level.** Tests connect over Unix socket or WebSocket. They test the actual protocol behavior, not internal implementation.
- **CI-friendly.** Exit code 0 on success, non-zero on failure. Structured output for test reporters.
- **Incremental.** Start simple (connect + assert tree shape), grow into complex scenarios (multi-step workflows, timing, concurrent subscriptions).

## Approach 1: Declarative YAML specs

A test spec is a YAML file describing a sequence of steps. Each step is either an **assertion** on the current tree state, an **invocation** of an affordance, or a **wait** for a condition.

### Example: Testing a task manager

```yaml
name: Task manager CRUD
connect: unix:/tmp/slop/tsk.sock

steps:
  # Verify initial tree structure
  - assert:
      path: /
      type: root

  - assert:
      path: /tasks
      type: collection

  # Add a task
  - invoke:
      path: /tasks
      action: add
      params:
        title: "Test task"
        tag: "ci"

  # Verify it appeared
  - assert:
      path: /tasks
      has_child:
        property:
          title: "Test task"

  # Complete it
  - invoke:
      path: /tasks/test-task
      action: complete

  # Verify status changed
  - assert:
      path: /tasks/test-task
      property:
        status: done
```

### Example: Testing a form

```yaml
name: Login form states
connect: ws://localhost:3000/slop

steps:
  - assert:
      path: /auth/login
      type: form
      has_affordance: submit

  - invoke:
      path: /auth/login
      action: submit
      params:
        email: "bad"
        password: ""

  - assert:
      path: /auth/login/email
      property:
        error: "Invalid email"

  - invoke:
      path: /auth/login
      action: submit
      params:
        email: "user@test.com"
        password: "secret"

  - assert:
      path: /auth/dashboard
      type: view
```

### Example: Testing attention and salience

```yaml
name: Notification urgency
connect: unix:/tmp/slop/app.sock

steps:
  - invoke:
      path: /system
      action: trigger_alert
      params:
        level: critical

  - assert:
      path: /notifications/alert-1
      type: notification
      meta:
        urgency: critical
        salience_gte: 0.9
```

### Assertion vocabulary

| Field | Meaning |
|-------|---------|
| `path` | Node path to check (required) |
| `type` | Expected node type |
| `property` | Map of property key/value pairs that must match |
| `has_affordance` | Action name that must exist on the node |
| `no_affordance` | Action name that must NOT exist |
| `has_child` | At least one child matches the given criteria |
| `child_count` | Exact number of children |
| `child_count_gte` | Minimum number of children |
| `meta` | Map of meta fields to check (urgency, salience_gte, changed, etc.) |
| `exists: false` | Node must NOT exist at this path |

### Invoke fields

| Field | Meaning |
|-------|---------|
| `path` | Node path (required) |
| `action` | Affordance action name (required) |
| `params` | Map of parameters |
| `expect_status` | Expected result status (default: `ok`) |
| `expect_error` | Expected error message pattern |

### Control flow

| Step type | Meaning |
|-----------|---------|
| `wait` | Pause for a duration (`wait: 500ms`) or until a condition (`wait: { path: /x, property: { ready: true }, timeout: 5s }`) |
| `subscribe` | Change subscription (path, depth, filter) |
| `snapshot` | Save current tree state with a label for later comparison |
| `diff` | Compare current tree to a named snapshot |

## Approach 2: Protocol replay and recording

Instead of writing specs by hand, record a session and replay it.

### Recording

```bash
slop-inspect --connect /tmp/slop/app.sock --record session.json
```

Every protocol message (snapshots, patches, invocations, results) is captured with timestamps. The user interacts normally through the inspector TUI. When they disconnect, the session is saved.

### Replay as test

```bash
slop-test replay session.json --connect /tmp/slop/app.sock
```

The runner replays all invocations from the recording and asserts that the resulting tree state matches the recorded snapshots at each point. This catches regressions — if the provider's behavior diverges from the recording, the test fails.

### Advantages

- Zero-effort test creation — just use the inspector
- Captures real interaction patterns
- Great for regression testing after refactors

### Challenges

- Recordings are brittle if IDs or timestamps change
- Need a diffing strategy that ignores volatile fields
- Large recordings are hard to debug when they fail

### Mitigation: Selective assertions

Instead of asserting the entire tree matches, the replay runner can be configured to only check specific paths or properties:

```bash
slop-test replay session.json \
  --connect /tmp/slop/app.sock \
  --assert-paths "/tasks,/tasks/*/properties/status" \
  --ignore-fields "created,updated"
```

## Approach 3: Snapshot testing

Inspired by Jest snapshots. On first run, the tree state is saved. On subsequent runs, the current tree is compared to the snapshot.

```bash
# First run: creates .slop-snapshots/initial-tree.json
slop-test snapshot --connect /tmp/slop/tsk.sock --name initial-tree

# Subsequent runs: compares and fails on diff
slop-test snapshot --connect /tmp/slop/tsk.sock --name initial-tree
```

Update snapshots explicitly:

```bash
slop-test snapshot --connect /tmp/slop/tsk.sock --name initial-tree --update
```

### When to use

- Verifying that a provider's initial state hasn't changed unexpectedly
- Catching unintended tree structure changes during refactors
- Quick smoke tests in CI

## Approach 4: Property-based / fuzzing

Generate random sequences of affordance invocations and check invariants.

```yaml
name: Task manager invariants
connect: unix:/tmp/slop/tsk.sock

fuzz:
  steps: 50
  seed: 42

invariants:
  # Task count should never be negative
  - path: /tasks
    meta:
      total_children_gte: 0

  # Completed tasks should not have a "complete" affordance
  - path: /tasks/*
    when:
      property:
        status: done
    no_affordance: complete

  # All items in /tasks should be type "item"
  - path: /tasks/*
    type: item
```

The fuzzer:
1. Reads the tree and collects all available affordances
2. Picks one at random (with valid random params based on JSON Schema)
3. Invokes it
4. Checks all invariants still hold
5. Repeats for N steps

This finds edge cases that scripted tests miss — what happens when you complete an already-completed task? What if you add 1000 tasks? What if you invoke actions in an unexpected order?

## CLI interface

All approaches use the same binary:

```bash
# Run a YAML spec
slop-test run test-crud.yaml

# Run all specs in a directory
slop-test run tests/

# Record a session
slop-inspect --connect /tmp/slop/app.sock --record session.json

# Replay a recorded session
slop-test replay session.json --connect /tmp/slop/app.sock

# Snapshot test
slop-test snapshot --connect /tmp/slop/tsk.sock --name smoke

# Fuzz test
slop-test fuzz invariants.yaml

# All commands support:
#   --timeout 30s       Global timeout
#   --verbose            Show all protocol messages
#   --json               Machine-readable output (for CI reporters)
#   --connect <addr>     Override the spec's connect field
```

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | All tests passed |
| 1 | One or more assertions failed |
| 2 | Connection error (provider not reachable) |
| 3 | Spec parse error |

### Output

Default output is human-readable:

```
$ slop-test run test-crud.yaml

  Task manager CRUD
    ✓ assert / is root
    ✓ assert /tasks is collection
    ✓ invoke /tasks → add
    ✓ assert /tasks has child with title="Test task"
    ✓ invoke /tasks/test-task → complete
    ✓ assert /tasks/test-task status=done

  6/6 passed (0.34s)
```

JSON output for CI integration:

```json
{
  "name": "Task manager CRUD",
  "passed": true,
  "steps": 6,
  "failures": 0,
  "duration_ms": 340,
  "results": [
    {"step": 1, "type": "assert", "passed": true, "path": "/"},
    {"step": 2, "type": "assert", "passed": true, "path": "/tasks"}
  ]
}
```

## CI integration

### GitHub Actions

```yaml
- name: Start SLOP provider
  run: |
    cd my-app && ./start --slop &
    sleep 2

- name: Run SLOP tests
  run: slop-test run tests/ --json --timeout 30s
```

### With any provider language

```bash
# Python provider
cd my-python-app && python app.py --slop &

# Rust provider
cd my-rust-app && cargo run -- --slop &

# TypeScript provider
cd my-ts-app && bun run src/index.ts --slop &

# Same test spec works for all of them
slop-test run tests/
```

The provider language doesn't matter. The tests speak the protocol.

## Combining approaches

These approaches aren't mutually exclusive. A realistic test suite might use:

1. **YAML specs** for core CRUD workflows and happy paths
2. **Snapshots** for smoke testing initial tree structure
3. **Replay** for regression testing after a session revealed a bug
4. **Fuzzing** for finding edge cases in action handling

## Implementation path

The architecture supports this today. `provider.Manager` already handles connect, subscribe, tree mirroring, and invoke — all headless, no TUI required. The test runner is a second consumer of the same API:

```
provider.Manager
  ├── tui/inspector.go   (interactive debugging)
  └── test/runner.go     (automated testing)
```

What needs to be built:

1. **YAML spec parser** — parse steps, assertions, invocations
2. **Assertion engine** — walk the tree, match paths, check properties
3. **Test runner** — execute steps sequentially, collect results
4. **Reporter** — human-readable + JSON output
5. **CLI integration** — `slop-test` subcommand or separate binary
