# `slop-ai`

Go SDK for SLOP (State Layer for Observable Programs).

Use it to publish state from HTTP services, daemons, desktop apps, and CLI tools, or to connect to other SLOP providers as a consumer.

## Installation

```bash
go get github.com/devteapot/slop/packages/go/slop-ai
```

Requires Go 1.22 or later.

## Quick start

```go
package main

import (
	"log"
	"net/http"

	slop "github.com/devteapot/slop/packages/go/slop-ai"
)

func main() {
	server := slop.NewServer("my-app", "My App")

	server.Register("status", slop.Node{
		Type:  "status",
		Props: slop.Props{"healthy": true},
	})

	server.Mount(http.DefaultServeMux)

	log.Fatal(http.ListenAndServe(":8080", nil))
}
```

That mounts:

- `GET /slop` for the WebSocket transport
- `GET /.well-known/slop` for provider discovery

## Included APIs

- `Server`, `ScopedServer`, and `RegisterFunc` for providers
- `Consumer` plus WebSocket and Unix client transports
- `discovery` subpackage for provider scanning, bridge relay, lazy/auto-connect, and AI-facing tool helpers
- stdio and Unix transports for local tools
- scaling helpers and LLM tool formatting helpers

## Discovery layer

The Go SDK now includes the core discovery layer in the `discovery` subpackage:

```go
import (
	"context"

	"github.com/devteapot/slop/packages/go/slop-ai/discovery"
)

svc := discovery.NewService(discovery.ServiceOptions{})
svc.Start(context.Background())
defer svc.Stop()

provider, err := svc.EnsureConnected(context.Background(), "my-app")
if err != nil {
	panic(err)
}
if provider != nil {
	println(provider.Name)
}
```

## Documentation

- API reference: https://docs.slopai.dev/api/go
- Go guide: https://docs.slopai.dev/guides/go
- Protocol spec: https://docs.slopai.dev/spec/core/overview
