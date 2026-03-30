---
title: Go
description: Add SLOP to Go apps — HTTP services, CLI tools, daemons
---

## Install

```bash
go get github.com/slop-ai/slop-go
```

Single external dependency (`nhooyr.io/websocket`). Everything else is Go stdlib.

## HTTP service (net/http)

The Go SDK's standout feature: `server.Mount(mux)` works with **any** `net/http` compatible router — stdlib, chi, gin, echo, fiber.

```go
package main

import (
    "context"
    "net/http"

    slop "github.com/slop-ai/slop-go"
)

func main() {
    server := slop.NewServer("my-api", "My API")

    // Static registration — struct literals
    server.Register("status", slop.Node{
        Type:  "status",
        Props: slop.Props{"healthy": true, "version": "1.0"},
    })

    // Dynamic registration — re-evaluated on Refresh()
    server.RegisterFunc("todos", func() slop.Node {
        todos := db.GetTodos()
        return slop.Node{
            Type:  "collection",
            Props: slop.Props{"count": len(todos)},
            Items: todosToItems(todos),
        }
    })

    // Action handler — mirrors http.Handler pattern
    server.Handle("todos", "create", slop.HandlerFunc(
        func(ctx context.Context, p slop.Params) (any, error) {
            db.CreateTodo(p.String("title"))
            return nil, nil
        },
    ))

    // Action with metadata
    server.HandleWith("todos", "clear", slop.HandlerFunc(
        func(ctx context.Context, p slop.Params) (any, error) {
            db.ClearTodos()
            return nil, nil
        },
    ), slop.ActionOpts{Dangerous: true, Label: "Clear all"})

    // Mount WebSocket + discovery on any mux
    mux := http.NewServeMux()
    server.Mount(mux) // adds /slop (ws) + /.well-known/slop (json)

    // Add your own routes alongside SLOP
    mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
        w.Write([]byte("ok"))
    })

    http.ListenAndServe(":8080", mux)
}
```

After a mutation outside SLOP (e.g., an HTTP endpoint), call `server.Refresh()`:

```go
mux.HandleFunc("POST /api/todos", func(w http.ResponseWriter, r *http.Request) {
    // ... create todo ...
    server.Refresh() // re-evaluate RegisterFunc, diff, broadcast
    w.WriteHeader(http.StatusCreated)
})
```

### Individual handlers

If you need custom routing, use the handlers directly:

```go
mux.Handle("GET /slop", server.WebSocketHandler())
mux.Handle("GET /.well-known/slop", server.DiscoveryHandler())
```

### Works with chi

```go
r := chi.NewRouter()
r.Handle("/slop", server.WebSocketHandler())
r.Get("/.well-known/slop", server.DiscoveryHandler().ServeHTTP)
```

## Unix socket (daemons, local agents)

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

err := slop.ListenUnix(ctx, server, "/tmp/slop/my-daemon.sock",
    slop.WithDiscovery(true), // writes ~/.slop/providers/my-daemon.json
)
```

The SLOP desktop app watches `~/.slop/providers/` and auto-discovers Unix socket providers.

## Stdio (CLI tools)

```go
ctx := context.Background()
err := slop.ListenStdio(ctx, server)
```

Reads NDJSON from stdin, writes to stdout. Single consumer. Blocks until stdin closes.

## Descriptors

Go uses typed structs for descriptors — autocomplete and compile-time safety:

```go
server.Register("inbox", slop.Node{
    Type:    "collection",
    Summary: "42 messages, 5 unread",
    Props:   slop.Props{"count": 42, "unread": 5},
    Items: []slop.Item{
        {
            ID:    "msg-1",
            Props: slop.Props{"from": "alice", "subject": "Hello", "unread": true},
        },
        {
            ID:    "msg-2",
            Props: slop.Props{"from": "bob", "subject": "Meeting", "unread": false},
        },
    },
    Meta: &slop.Meta{
        Salience: floatPtr(0.8),
        Urgency:  "medium",
    },
})
```

### Actions inline

Actions can be registered inline in the descriptor or separately via `Handle`:

```go
server.Register("todos", slop.Node{
    Type: "collection",
    Actions: slop.Actions{
        "create": slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
            db.CreateTodo(p.String("title"))
            return nil, nil
        }),
        "clear": slop.WithOpts(
            slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
                db.ClearTodos()
                return nil, nil
            }),
            slop.ActionOpts{Dangerous: true},
        ),
    },
})
```

### Content references

```go
server.Register("editor/main-go", slop.Node{
    Type:  "document",
    Props: slop.Props{"title": "main.go", "language": "go"},
    ContentRef: &slop.ContentRef{
        Type:    "text",
        MIME:    "text/x-go",
        Summary: "Go HTTP server, 150 lines, 3 routes",
        Preview: "package main\n\nimport \"net/http\"\n...",
    },
})
```

## Scoped registration

```go
settings := server.Scope("settings")
settings.Register("account", slop.Node{
    Type:  "group",
    Props: slop.Props{"email": "a@b.com"},
})
settings.Register("theme", slop.Node{
    Type:  "group",
    Props: slop.Props{"dark": true},
})
// registers at "settings/account" and "settings/theme"
```

## Handler interface

The `Handler` interface mirrors `http.Handler`:

```go
type Handler interface {
    HandleAction(ctx context.Context, params Params) (any, error)
}

// HandlerFunc adapter — like http.HandlerFunc
type HandlerFunc func(ctx context.Context, params Params) (any, error)
```

`Params` provides typed accessors to avoid type assertions:

```go
func handler(ctx context.Context, p slop.Params) (any, error) {
    title := p.String("title")   // string
    count := p.Int("count")      // int
    done := p.Bool("done")       // bool
    score := p.Float("score")    // float64
    return nil, nil
}
```

## Multiple transports

A server can expose multiple transports sharing the same state:

```go
// HTTP for remote consumers
mux := http.NewServeMux()
server.Mount(mux)
go http.ListenAndServe(":8080", mux)

// Unix socket for local agents
go slop.ListenUnix(ctx, server, "/tmp/slop/my-app.sock")
```

## Consumer

Connect to a SLOP provider, subscribe to state, and invoke actions:

```go
transport := &slop.WSClientTransport{URL: "ws://localhost:8765/slop"}
consumer := slop.NewConsumer(transport)

hello, err := consumer.Connect(ctx)
fmt.Println("Connected to", hello["provider"])

subID, tree, err := consumer.Subscribe(ctx, "/", -1)
fmt.Printf("Got %d children\n", len(tree.Children))

// Invoke an action
result, err := consumer.Invoke(ctx, "/todos", "create", slop.Params{"title": "New task"})

// Listen for patches
consumer.OnPatch(func(subID string, ops []slop.PatchOp, version int) {
    fmt.Printf("Patch v%d: %d ops\n", version, len(ops))
})

// Query a subtree
node, err := consumer.Query(ctx, "/todos", 1)

consumer.Disconnect()
```

Transports: `WSClientTransport` and `UnixClientTransport`.

## Scaling

Prepare trees for output with depth truncation, salience filtering, and node-budget compaction:

```go
// Apply all scaling in one call
opts := slop.OutputTreeOptions{
    MaxDepth:    intPtr(2),
    MinSalience: floatPtr(0.3),
    MaxNodes:    intPtr(50),
}
prepared := slop.PrepareTree(tree, opts)

// Or apply individually
shallow := slop.TruncateTree(tree, 2)
relevant := slop.FilterTree(tree, floatPtr(0.5), nil)
compact := slop.AutoCompact(tree, 50)

// Extract a subtree
sub := slop.GetSubtree(&tree, "/inbox/msg-42")
```

## LLM tools

Convert a SLOP tree into LLM-compatible tool definitions:

```go
// Convert tree affordances to OpenAI-style tool list
tools := slop.AffordancesToTools(tree, "")
// []LlmTool{{Type: "function", Function: {Name: "invoke__todos__create", ...}}}

// Format tree as readable text for LLM context
context := slop.FormatTree(tree, 0)

// Encode/decode tool names
name := slop.EncodeTool("/todos", "create")   // "invoke__todos__create"
path, action := slop.DecodeTool(name)          // "/todos", "create"
```
