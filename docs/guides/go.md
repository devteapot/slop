# Go

## Install

```bash
go get github.com/devteapot/slop/packages/go/slop-ai
```

The Go SDK uses the standard library plus `nhooyr.io/websocket` for WebSocket support.

## HTTP service

```go
package main

import (
	"context"
	"log"
	"net/http"

	slop "github.com/devteapot/slop/packages/go/slop-ai"
)

func main() {
	server := slop.NewServer("my-api", "My API")

	server.Register("status", slop.Node{
		Type:  "status",
		Props: slop.Props{"healthy": true},
	})

	server.Handle("status", "restart", slop.HandlerFunc(
		func(ctx context.Context, params slop.Params) (any, error) {
			return map[string]any{"ok": true}, nil
		},
	))

	server.Mount(http.DefaultServeMux)

	log.Fatal(http.ListenAndServe(":8080", nil))
}
```

`server.Mount()` adds:

- `GET /slop` for the WebSocket endpoint
- `GET /.well-known/slop` for provider discovery

## Dynamic state

Use `RegisterFunc()` for state that should be re-read on every refresh:

```go
server.RegisterFunc("metrics", func() slop.Node {
	return slop.Node{
		Type:  "status",
		Props: slop.Props{"requests": getRequestCount()},
	}
})
```

Call `server.Refresh()` after mutations outside SLOP actions.

## Unix socket and stdio

For local apps and CLI tools:

```go
ctx := context.Background()

go slop.ListenUnix(ctx, server, "/tmp/slop/my-app.sock", slop.WithDiscovery(true))
go slop.ListenStdio(ctx, server)
```

Use `WithDiscovery(true)` to write `~/.slop/providers/<id>.json` for local discovery.

## Consumer example

```go
transport := &slop.WSClientTransport{URL: "ws://localhost:8080/slop"}
consumer := slop.NewConsumer(transport)

hello, _ := consumer.Connect(context.Background())
subID, snapshot, _ := consumer.Subscribe(context.Background(), "/", -1)
_, _ = consumer.Invoke(context.Background(), "/status", "restart", nil)

fmt.Println(hello["provider"], subID, snapshot.ID)
```

## Discovery layer

The Go SDK also includes the core discovery layer in the `discovery` subpackage:

```go
import (
	"context"
	"fmt"

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
	fmt.Println(provider.Name)
}
```

## Next Steps

- [Go package API](/api/go)
- [Consumer guide](/guides/consumer)
- [Server and native apps guide](/guides/server-apps)
