---
title: "Async Actions"
---
Some actions take seconds, minutes, or longer to complete — deployments, report generation, test runs, video processing, large file operations. The AI can't wait indefinitely for a result, and it needs to see progress, be able to cancel, and handle failures.

SLOP handles async actions using **existing primitives**: the state tree and affordances. No new message types, no special transport — just a pattern built on what's already there.

## The problem

Synchronous action flow:

```
AI → invoke("deploy", { env: "production" })
     ... AI waits ...
     ... 5 minutes pass ...
← result: { status: "ok" }
```

Problems:
- The AI is blocked for 5 minutes — it can't help the user with anything else
- No progress visibility — the AI doesn't know if it's at 10% or 90%
- No cancellation — if the user changes their mind, there's no way to stop
- Timeout risk — the consumer may drop the connection before the result arrives

## The solution

Async actions return immediately and report progress through the state tree.

```
AI → invoke("deploy", { env: "production" })
← result: { status: "accepted", data: { taskId: "deploy-123" } }

// Progress appears as a node in the state tree:
[status] deploy-123 (progress=0.3, message="Building...")  {cancel}
[status] deploy-123 (progress=0.7, message="Running tests...")  {cancel}
[status] deploy-123 (progress=1.0, message="Deploy complete", status="done")
```

The AI gets its result immediately, sees progress via normal tree patches, and can cancel via an affordance on the task node. No new protocol concepts — just nodes, properties, and affordances.

## Protocol

### The `accepted` result status

A new `status` value on `ResultMessage`:

```jsonc
{
  "type": "result",
  "id": "inv-1",
  "status": "accepted",    // NEW — action started, not yet complete
  "data": {
    "taskId": "deploy-123"  // reference to the task node in the tree
  }
}
```

| Status | Meaning | AI behavior |
|---|---|---|
| `"ok"` | Action completed synchronously | Read the result, done |
| `"error"` | Action failed | Read the error, report to user |
| `"accepted"` | Action started asynchronously | Watch the tree for a task status node |

The `accepted` status is analogous to HTTP `202 Accepted` — the request was valid, processing has started, but the outcome is not yet known.

### The `estimate` affordance field

Affordances can declare their expected duration via the `estimate` field (already defined in [Affordances](/spec/core/affordances)):

```jsonc
{
  "action": "deploy",
  "description": "Deploy to production",
  "estimate": "async",    // tells the AI: this returns immediately, watch for progress
  "params": { ... }
}
```

| Estimate | Meaning |
|---|---|
| `"instant"` | Completes immediately (default) |
| `"fast"` | Under 1 second |
| `"slow"` | Over 1 second but still synchronous |
| `"async"` | Returns immediately, progress via state tree |

The AI uses `estimate` to set expectations before invoking. An `"async"` action means: invoke it, get back `accepted`, then monitor the tree.

## Task nodes

When an async action starts, the provider creates a **task node** in the state tree. This is a regular node — no special type, just a convention.

### Schema

```jsonc
{
  "id": "deploy-123",
  "type": "status",
  "properties": {
    "action": "deploy",              // which action spawned this task
    "status": "running",             // "pending" | "running" | "done" | "failed" | "cancelled"
    "progress": 0.45,                // 0–1, optional
    "message": "Running tests...",   // human/AI-readable status message
    "started_at": "2026-03-29T10:30:00Z",
    "params": { "env": "production" }  // original action params, for context
  },
  "meta": {
    "salience": 0.8,                 // active tasks should have high salience
    "urgency": "medium"
  },
  "affordances": [
    { "action": "cancel", "description": "Cancel this deployment", "dangerous": true }
  ]
}
```

### Task status values

| Status | Meaning | What happens next |
|---|---|---|
| `"pending"` | Queued, not yet started | Will transition to `"running"` |
| `"running"` | In progress | Progress updates via patches, will transition to `"done"` or `"failed"` |
| `"done"` | Completed successfully | May include result data in properties, node may be auto-removed after a delay |
| `"failed"` | Completed with error | Error details in properties, salience/urgency raised |
| `"cancelled"` | User or AI cancelled | Node may be auto-removed |

### Task lifecycle

```
pending → running → done
                  → failed
                  → cancelled (via cancel affordance)
```

### Where task nodes live

Convention: register task nodes under a `tasks` path:

```
[root] My App
  [view] Dashboard (current active view)
  [status] tasks/deploy-123 (progress=0.45, "Running tests...")  {cancel}
  [status] tasks/report-456 (progress=0.1, "Generating Q3 report...")  {cancel}
```

The AI sees active tasks alongside the rest of the app state. Multiple tasks can run concurrently.

## Developer API

### In `@slop-ai/core` descriptors

```ts
// Declare an async action
slop.register("ci", {
  type: "view",
  props: { label: "CI/CD" },
  actions: {
    deploy: {
      label: "Deploy",
      description: "Deploy to an environment",
      estimate: "async",
      params: { env: { type: "string", enum: ["staging", "production"] } },
      handler: ({ env }) => {
        const taskId = `deploy-${Date.now()}`;

        // Register initial task node
        slop.register(`tasks/${taskId}`, {
          type: "status",
          props: {
            action: "deploy",
            status: "running",
            progress: 0,
            message: `Deploying to ${env}...`,
            started_at: new Date().toISOString(),
            params: { env },
          },
          meta: { salience: 0.8 },
          actions: {
            cancel: {
              dangerous: true,
              handler: () => {
                abortDeploy(taskId);
                slop.register(`tasks/${taskId}`, {
                  type: "status",
                  props: { action: "deploy", status: "cancelled", message: "Deployment cancelled" },
                  meta: { salience: 0.5 },
                });
                setTimeout(() => slop.unregister(`tasks/${taskId}`), 10000);
              },
            },
          },
        });

        // Run the actual work in the background
        runDeploy(env as string, {
          onProgress: (progress, message) => {
            slop.register(`tasks/${taskId}`, {
              type: "status",
              props: { action: "deploy", status: "running", progress, message, params: { env } },
              meta: { salience: 0.8 },
              actions: {
                cancel: { dangerous: true, handler: () => abortDeploy(taskId) },
              },
            });
          },
          onDone: (result) => {
            slop.register(`tasks/${taskId}`, {
              type: "status",
              props: { action: "deploy", status: "done", progress: 1, message: "Deploy complete", result },
              meta: { salience: 0.6 },
            });
            // Auto-remove completed task after 30 seconds
            setTimeout(() => slop.unregister(`tasks/${taskId}`), 30000);
          },
          onError: (err) => {
            slop.register(`tasks/${taskId}`, {
              type: "status",
              props: { action: "deploy", status: "failed", message: err.message },
              meta: { salience: 1.0, urgency: "high" },
            });
          },
        });

        // Return immediately with accepted status
        return { __async: true, taskId };
      },
    },
  },
});
```

### The `__async` return convention

When a handler returns an object with `__async: true`, the provider sends `status: "accepted"` instead of `status: "ok"`:

```ts
// Handler returns:
return { __async: true, taskId: "deploy-123" };

// Provider sends:
{ "type": "result", "id": "inv-1", "status": "accepted", "data": { "taskId": "deploy-123" } }
```

If the handler doesn't return `__async: true`, the behavior is unchanged — `status: "ok"` as before. This is backwards-compatible.

## AI interaction flow

### Starting an async action

```
User: "Deploy to production"

AI sees the deploy affordance with estimate: "async"
AI → invoke("/ci", "deploy", { env: "production" })
← result: { status: "accepted", data: { taskId: "deploy-123" } }

AI: "I've started the deployment to production. I'll keep you updated on progress."
```

### Monitoring progress

The AI doesn't poll — it receives patches as the task node updates:

```
← patch: /tasks/deploy-123/properties/progress = 0.3
← patch: /tasks/deploy-123/properties/message = "Building..."

AI: "Deployment is 30% complete — currently building the application."

← patch: /tasks/deploy-123/properties/progress = 0.7
← patch: /tasks/deploy-123/properties/message = "Running tests..."

AI: "Now at 70% — running the test suite."
```

### Completion

```
← patch: /tasks/deploy-123/properties/status = "done"
← patch: /tasks/deploy-123/properties/progress = 1
← patch: /tasks/deploy-123/properties/message = "Deploy complete"

AI: "Deployment to production completed successfully."
```

### Failure

```
← patch: /tasks/deploy-123/properties/status = "failed"
← patch: /tasks/deploy-123/properties/message = "Test suite failed: 3 tests broken"
← patch: /tasks/deploy-123/meta/urgency = "high"

AI: "The deployment failed — 3 tests broke during the test suite. Would you like me to investigate?"
```

### Cancellation

```
User: "Cancel the deployment"

AI sees the cancel affordance on the task node
AI → invoke("/tasks/deploy-123", "cancel")
← result: { status: "ok" }

← patch: /tasks/deploy-123/properties/status = "cancelled"

AI: "Deployment cancelled."
```

## Multiple concurrent tasks

The tree naturally supports multiple async actions running simultaneously:

```
[root] My App
  [view] Dashboard
  [status] tasks/deploy-123 (progress=0.7, "Running tests...")  {cancel}
  [status] tasks/backup-456 (progress=0.2, "Backing up database...")  {cancel}
  [status] tasks/report-789 (status="done", "Q3 report generated")
```

The AI can report on all active tasks:
```
"Three background tasks: deployment is at 70% (running tests), database backup is at 20%,
and the Q3 report is finished."
```

## Consumer handling

### For AI agents (extension, desktop, OpenClaw)

When the AI receives `status: "accepted"`:
1. Note the taskId
2. Continue responding to the user — don't block
3. Watch for patches on the task node
4. Report progress when meaningful changes occur
5. Report completion or failure

The system prompt should instruct the AI:
```
When you invoke an action and receive status "accepted", it means the action is running
in the background. Monitor the task node in the state tree for progress. Report significant
updates to the user. You can invoke "cancel" on the task node if the user asks to stop it.
```

### For simple consumers

Consumers that don't need progress tracking can ignore task nodes and just treat `accepted` as `ok`. The action was successfully started — that's all they need to know.

## When to use async vs sync

| Action | Duration | Use |
|---|---|---|
| Toggle a boolean | Instant | Sync (`estimate: "instant"`) |
| Save a form | < 1s | Sync (`estimate: "fast"`) |
| API call | 1-5s | Sync (`estimate: "slow"`) |
| Run tests | 30s–5min | **Async** (`estimate: "async"`) |
| Deploy | 1–10min | **Async** |
| Generate report | 10s–2min | **Async** |
| Process video | Minutes–hours | **Async** |
| Database migration | Variable | **Async** |

**Rule of thumb:** if the user might want to do something else while waiting, make it async.
