package slop

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
)

// ClientConnection is a bidirectional message connection (client-side).
type ClientConnection interface {
	Send(msg map[string]any) error
	OnMessage(handler func(map[string]any))
	OnClose(handler func())
	Close() error
}

// ClientTransport establishes a client connection to a SLOP provider.
type ClientTransport interface {
	Connect(ctx context.Context) (ClientConnection, error)
}

// Consumer connects to a SLOP provider and mirrors state.
type Consumer struct {
	transport  ClientTransport
	conn       ClientConnection
	mirrors    map[string]*StateMirror
	pending    map[string]chan map[string]any
	subCounter int
	reqCounter int
	mu         sync.Mutex

	onPatch      []func(subID string, ops []PatchOp, version int)
	onDisconnect []func()
}

// NewConsumer creates a Consumer that will use the given transport to connect.
func NewConsumer(transport ClientTransport) *Consumer {
	return &Consumer{
		transport: transport,
		mirrors:   map[string]*StateMirror{},
		pending:   map[string]chan map[string]any{},
	}
}

// Connect establishes the connection and waits for the provider's hello message.
func (c *Consumer) Connect(ctx context.Context) (map[string]any, error) {
	conn, err := c.transport.Connect(ctx)
	if err != nil {
		return nil, err
	}
	c.conn = conn

	helloCh := make(chan map[string]any, 1)

	conn.OnMessage(func(msg map[string]any) {
		c.handleMessage(msg, helloCh)
	})

	conn.OnClose(func() {
		c.mu.Lock()
		handlers := make([]func(), len(c.onDisconnect))
		copy(handlers, c.onDisconnect)
		c.mu.Unlock()
		for _, fn := range handlers {
			fn()
		}
	})

	select {
	case hello := <-helloCh:
		return hello, nil
	case <-ctx.Done():
		conn.Close()
		return nil, ctx.Err()
	}
}

func (c *Consumer) handleMessage(msg map[string]any, helloCh chan map[string]any) {
	msgType, _ := msg["type"].(string)

	switch msgType {
	case "hello":
		select {
		case helloCh <- msg:
		default:
		}

	case "snapshot":
		id, _ := msg["id"].(string)
		version := jsonInt(msg["version"])
		tree := unmarshalWireNodeFromAny(msg["tree"])

		c.mu.Lock()
		c.mirrors[id] = NewStateMirror(tree, version)
		ch, hasPending := c.pending[id]
		if hasPending {
			delete(c.pending, id)
		}
		c.mu.Unlock()

		if hasPending {
			ch <- msg
		}

	case "patch":
		id, _ := msg["subscription"].(string)
		if id == "" {
			id, _ = msg["id"].(string) // fallback for compat
		}
		version := jsonInt(msg["version"])
		ops := unmarshalPatchOps(msg["ops"])

		c.mu.Lock()
		mirror, ok := c.mirrors[id]
		if ok {
			mirror.ApplyPatch(ops, version)
		}
		handlers := make([]func(string, []PatchOp, int), len(c.onPatch))
		copy(handlers, c.onPatch)
		c.mu.Unlock()

		for _, fn := range handlers {
			fn(id, ops, version)
		}

	case "result":
		id, _ := msg["id"].(string)
		c.mu.Lock()
		ch, ok := c.pending[id]
		if ok {
			delete(c.pending, id)
		}
		c.mu.Unlock()
		if ok {
			ch <- msg
		}
	}
}

// Subscribe sends a subscribe message and waits for the initial snapshot.
// Returns the subscription ID, the initial tree, and any error.
func (c *Consumer) Subscribe(ctx context.Context, path string, depth int) (string, WireNode, error) {
	c.mu.Lock()
	c.subCounter++
	id := fmt.Sprintf("sub_%d", c.subCounter)
	ch := make(chan map[string]any, 1)
	c.pending[id] = ch
	c.mu.Unlock()

	err := c.conn.Send(map[string]any{
		"type":  "subscribe",
		"id":    id,
		"path":  path,
		"depth": depth,
	})
	if err != nil {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return "", WireNode{}, err
	}

	select {
	case msg := <-ch:
		tree := unmarshalWireNodeFromAny(msg["tree"])
		return id, tree, nil
	case <-ctx.Done():
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return "", WireNode{}, ctx.Err()
	}
}

// Unsubscribe removes a subscription.
func (c *Consumer) Unsubscribe(id string) {
	c.mu.Lock()
	delete(c.mirrors, id)
	c.mu.Unlock()

	if c.conn != nil {
		_ = c.conn.Send(map[string]any{
			"type": "unsubscribe",
			"id":   id,
		})
	}
}

// Query sends a one-shot query and returns the tree snapshot.
func (c *Consumer) Query(ctx context.Context, path string, depth int) (WireNode, error) {
	c.mu.Lock()
	c.reqCounter++
	id := fmt.Sprintf("q_%d", c.reqCounter)
	ch := make(chan map[string]any, 1)
	c.pending[id] = ch
	c.mu.Unlock()

	err := c.conn.Send(map[string]any{
		"type":  "query",
		"id":    id,
		"path":  path,
		"depth": depth,
	})
	if err != nil {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return WireNode{}, err
	}

	select {
	case msg := <-ch:
		tree := unmarshalWireNodeFromAny(msg["tree"])
		return tree, nil
	case <-ctx.Done():
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return WireNode{}, ctx.Err()
	}
}

// Invoke sends an action invocation and waits for the result.
func (c *Consumer) Invoke(ctx context.Context, path, action string, params Params) (map[string]any, error) {
	c.mu.Lock()
	c.reqCounter++
	id := fmt.Sprintf("r_%d", c.reqCounter)
	ch := make(chan map[string]any, 1)
	c.pending[id] = ch
	c.mu.Unlock()

	err := c.conn.Send(map[string]any{
		"type":   "invoke",
		"id":     id,
		"path":   path,
		"action": action,
		"params": params,
	})
	if err != nil {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, err
	}

	select {
	case msg := <-ch:
		status, _ := msg["status"].(string)
		if status == "error" {
			errData, _ := msg["error"].(map[string]any)
			errMsg := "unknown error"
			if errData != nil {
				if m, ok := errData["message"].(string); ok {
					errMsg = m
				}
			}
			return msg, fmt.Errorf("invoke failed: %s", errMsg)
		}
		return msg, nil
	case <-ctx.Done():
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, ctx.Err()
	}
}

// Tree returns the current mirrored tree for a subscription, or nil if not found.
func (c *Consumer) Tree(subscriptionID string) *WireNode {
	c.mu.Lock()
	defer c.mu.Unlock()
	mirror, ok := c.mirrors[subscriptionID]
	if !ok {
		return nil
	}
	tree := mirror.Tree()
	return &tree
}

// Disconnect closes the connection and cleans up.
func (c *Consumer) Disconnect() {
	if c.conn != nil {
		_ = c.conn.Close()
		c.conn = nil
	}
}

// OnPatch registers a callback invoked when patch operations are applied.
func (c *Consumer) OnPatch(fn func(subID string, ops []PatchOp, version int)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.onPatch = append(c.onPatch, fn)
}

// OnDisconnect registers a callback invoked when the connection is closed.
func (c *Consumer) OnDisconnect(fn func()) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.onDisconnect = append(c.onDisconnect, fn)
}

// --- helpers ---

func jsonInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	}
	return 0
}

func unmarshalWireNodeFromAny(v any) WireNode {
	return unmarshalWireNode(v)
}

func unmarshalPatchOps(v any) []PatchOp {
	var ops []PatchOp
	data, _ := json.Marshal(v)
	_ = json.Unmarshal(data, &ops)
	return ops
}
