# slop-go

Go SDK for SLOP (State Layer for Observable Programs).

Expose your application's state as a tree that AI agents can observe and
interact with over WebSocket.

## Installation

```
go get github.com/slop-ai/slop-go
```

Requires Go 1.22 or later.

## Quick Start

```go
package main

import (
	"context"
	"log"
	"net/http"

	slop "github.com/slop-ai/slop-go"
)

func main() {
	server := slop.NewServer("my-app", "My App")

	// Register a state node
	server.Register("status", slop.Node{
		Type:    "status",
		Summary: "Application health status",
		Props:   slop.Props{"healthy": true, "uptime": 3600},
	})

	// Register an action handler
	server.Handle("status", "restart", slop.HandlerFunc(
		func(ctx context.Context, params slop.Params) (any, error) {
			return map[string]any{"restarted": true}, nil
		},
	))

	// Mount SLOP endpoints on the default mux
	server.Mount(http.DefaultServeMux)

	log.Println("SLOP server listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
```

This registers a WebSocket endpoint at `/slop` and a discovery endpoint at
`/.well-known/slop`.

## Key Types

| Type | Description |
|------|-------------|
| `Server` | SLOP provider that manages state, connections, and message routing. Safe for concurrent use. |
| `Node` | Descriptor for registering state (type, props, children, actions). |
| `Handler` | Interface for handling action invocations. |
| `HandlerFunc` | Adapter to use ordinary functions as `Handler`. |
| `Params` | Action parameters with typed accessors (`String`, `Int`, `Bool`, `Float`). |

## Dynamic State

Use `RegisterFunc` to register state that is re-evaluated on every refresh:

```go
server.RegisterFunc("metrics", func() slop.Node {
	return slop.Node{
		Type:  "status",
		Props: slop.Props{"requests": getRequestCount()},
	}
})
```

## Documentation

- [Go Guide](https://docs.slopai.dev/guides/go)
- [SLOP Specification](https://github.com/devteapot/slop/tree/main/spec)

## License

MIT
