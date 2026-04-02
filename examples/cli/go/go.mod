module github.com/slop-ai/examples/cli/go

go 1.22

require github.com/devteapot/slop/packages/go/slop-ai v0.0.0

require nhooyr.io/websocket v1.8.17 // indirect

replace github.com/devteapot/slop/packages/go/slop-ai => ../../../packages/go/slop-ai
