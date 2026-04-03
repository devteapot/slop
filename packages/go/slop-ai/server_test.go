package slop

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
)

type mockConn struct {
	mu       sync.Mutex
	messages []map[string]any
	closed   bool
}

func newMockConn() *mockConn {
	return &mockConn{}
}

func (c *mockConn) Send(msg any) error {
	data, _ := json.Marshal(msg)
	var m map[string]any
	_ = json.Unmarshal(data, &m)
	c.mu.Lock()
	c.messages = append(c.messages, m)
	c.mu.Unlock()
	return nil
}

func (c *mockConn) Close() error {
	c.closed = true
	return nil
}

func (c *mockConn) Messages() []map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	cp := make([]map[string]any, len(c.messages))
	copy(cp, c.messages)
	return cp
}

func TestRegisterStatic(t *testing.T) {
	s := NewServer("app", "App")
	s.Register("status", Node{
		Type:  "status",
		Props: Props{"healthy": true},
	})

	if s.Version() != 1 {
		t.Fatalf("expected version 1, got %d", s.Version())
	}
	tree := s.Tree()
	if len(tree.Children) != 1 {
		t.Fatalf("expected 1 child, got %d", len(tree.Children))
	}
	if tree.Children[0].ID != "status" {
		t.Fatalf("expected child id 'status', got %q", tree.Children[0].ID)
	}
}

func TestRegisterFunc(t *testing.T) {
	counter := 0
	s := NewServer("app", "App")
	s.RegisterFunc("counter", func() Node {
		return Node{
			Type:  "status",
			Props: Props{"count": counter},
		}
	})

	tree := s.Tree()
	if tree.Children[0].Properties["count"] != 0 {
		t.Fatalf("expected count 0, got %v", tree.Children[0].Properties["count"])
	}

	counter = 5
	s.Refresh()
	tree = s.Tree()
	if tree.Children[0].Properties["count"] != 5 {
		t.Fatalf("expected count 5, got %v", tree.Children[0].Properties["count"])
	}
}

func TestConnectionLifecycle(t *testing.T) {
	s := NewServer("app", "App")
	s.Register("x", Node{Type: "group"})

	conn := newMockConn()
	s.HandleConnection(conn)

	msgs := conn.Messages()
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message (hello), got %d", len(msgs))
	}
	if msgs[0]["type"] != "hello" {
		t.Fatalf("expected hello, got %v", msgs[0]["type"])
	}
	provider := msgs[0]["provider"].(map[string]any)
	if provider["id"] != "app" {
		t.Fatalf("expected provider id 'app', got %v", provider["id"])
	}

	// Subscribe
	s.HandleMessage(context.Background(), conn, map[string]any{"type": "subscribe", "id": "sub-1"})
	msgs = conn.Messages()
	if msgs[1]["type"] != "snapshot" {
		t.Fatalf("expected snapshot, got %v", msgs[1]["type"])
	}

	// Query
	s.HandleMessage(context.Background(), conn, map[string]any{"type": "query", "id": "q-1"})
	msgs = conn.Messages()
	if msgs[2]["type"] != "snapshot" {
		t.Fatalf("expected snapshot, got %v", msgs[2]["type"])
	}

	// Disconnect
	s.HandleDisconnect(conn)
}

func TestInvoke(t *testing.T) {
	count := 0
	s := NewServer("app", "App")
	s.Register("counter", Node{
		Type:  "status",
		Props: Props{"count": 0},
	})

	s.Handle("counter", "increment", HandlerFunc(func(ctx context.Context, p Params) (any, error) {
		count++
		return nil, nil
	}))

	conn := newMockConn()
	s.HandleConnection(conn)
	s.HandleMessage(context.Background(), conn, map[string]any{
		"type":   "invoke",
		"id":     "inv-1",
		"path":   "/app/counter",
		"action": "increment",
	})

	msgs := conn.Messages()
	var result map[string]any
	for _, m := range msgs {
		if m["type"] == "result" {
			result = m
			break
		}
	}
	if result == nil {
		t.Fatal("no result message")
	}
	if result["status"] != "ok" {
		t.Fatalf("expected status ok, got %v", result["status"])
	}
	if count != 1 {
		t.Fatalf("expected count 1, got %d", count)
	}
}

func TestInvokeNotFound(t *testing.T) {
	s := NewServer("app", "App")
	conn := newMockConn()
	s.HandleConnection(conn)
	s.HandleMessage(context.Background(), conn, map[string]any{
		"type":   "invoke",
		"id":     "inv-1",
		"path":   "/app/missing",
		"action": "do_it",
	})

	msgs := conn.Messages()
	var result map[string]any
	for _, m := range msgs {
		if m["type"] == "result" {
			result = m
			break
		}
	}
	if result["status"] != "error" {
		t.Fatalf("expected error, got %v", result["status"])
	}
	errObj := result["error"].(map[string]any)
	if errObj["code"] != "not_found" {
		t.Fatalf("expected not_found, got %v", errObj["code"])
	}
}

func TestScope(t *testing.T) {
	s := NewServer("app", "App")
	settings := s.Scope("settings")
	settings.Register("account", Node{
		Type:  "group",
		Props: Props{"email": "a@b.com"},
	})

	tree := s.Tree()
	if tree.Children[0].ID != "settings" {
		t.Fatalf("expected settings, got %v", tree.Children[0].ID)
	}
	if tree.Children[0].Children[0].ID != "account" {
		t.Fatalf("expected account, got %v", tree.Children[0].Children[0].ID)
	}
}

func TestUnregister(t *testing.T) {
	s := NewServer("app", "App")
	s.Register("x", Node{Type: "group"})
	if len(s.Tree().Children) != 1 {
		t.Fatal("expected 1 child")
	}

	s.Unregister("x")
	if len(s.Tree().Children) != 0 {
		t.Fatal("expected 0 children after unregister")
	}
}

func TestBroadcastOnChange(t *testing.T) {
	s := NewServer("app", "App")
	s.Register("x", Node{Type: "group", Props: Props{"v": 1}})

	conn := newMockConn()
	s.HandleConnection(conn)
	s.HandleMessage(context.Background(), conn, map[string]any{"type": "subscribe", "id": "sub-1"})
	initial := len(conn.Messages())

	s.Register("x", Node{Type: "group", Props: Props{"v": 2}})
	if len(conn.Messages()) <= initial {
		t.Fatal("expected broadcast after change")
	}
}

func TestSubscribeWithDepthLimit(t *testing.T) {
	s := NewServer("app", "App")
	s.Register("parent", Node{
		Type: "group",
		Children: map[string]Node{
			"child": {
				Type: "group",
				Children: map[string]Node{
					"grandchild": {Type: "item", Props: Props{"deep": true}},
				},
			},
		},
	})

	conn := newMockConn()
	s.HandleConnection(conn)

	// Subscribe with depth 2 — should see parent and child, but grandchild truncated
	s.HandleMessage(context.Background(), conn, map[string]any{
		"type":  "subscribe",
		"id":    "sub-depth",
		"path":  "/",
		"depth": float64(2),
	})

	msgs := conn.Messages()
	var snapshot map[string]any
	for _, m := range msgs {
		if m["type"] == "snapshot" && m["id"] == "sub-depth" {
			snapshot = m
			break
		}
	}
	if snapshot == nil {
		t.Fatal("no snapshot received")
	}

	tree := unmarshalWireNode(snapshot["tree"])
	if len(tree.Children) == 0 {
		t.Fatal("expected root to have children")
	}
	parent := tree.Children[0]
	if len(parent.Children) == 0 {
		t.Fatal("expected parent to have children at depth 2")
	}
	child := parent.Children[0]
	// At depth 2, child is at depth 2, so grandchild should be truncated
	if len(child.Children) != 0 {
		t.Fatal("expected grandchild to be truncated at depth 2")
	}
}

func TestSubscribeWithSalienceFilter(t *testing.T) {
	lowSal := 0.2
	highSal := 0.9
	s := NewServer("app", "App")
	s.Register("important", Node{
		Type: "item",
		Meta: &Meta{Salience: &highSal},
	})
	s.Register("boring", Node{
		Type: "item",
		Meta: &Meta{Salience: &lowSal},
	})

	conn := newMockConn()
	s.HandleConnection(conn)

	s.HandleMessage(context.Background(), conn, map[string]any{
		"type": "subscribe",
		"id":   "sub-sal",
		"path": "/",
		"filter": map[string]any{
			"min_salience": 0.5,
		},
	})

	msgs := conn.Messages()
	var snapshot map[string]any
	for _, m := range msgs {
		if m["type"] == "snapshot" && m["id"] == "sub-sal" {
			snapshot = m
			break
		}
	}
	if snapshot == nil {
		t.Fatal("no snapshot received")
	}

	tree := unmarshalWireNode(snapshot["tree"])
	if len(tree.Children) != 1 {
		t.Fatalf("expected 1 child (filtered), got %d", len(tree.Children))
	}
	if tree.Children[0].ID != "important" {
		t.Fatalf("expected 'important' child, got %q", tree.Children[0].ID)
	}
}

func TestUnknownMessageError(t *testing.T) {
	s := NewServer("app", "App")
	conn := newMockConn()
	s.HandleConnection(conn)

	s.HandleMessage(context.Background(), conn, map[string]any{
		"type": "frobnicate",
		"id":   "bad-1",
	})

	msgs := conn.Messages()
	var errMsg map[string]any
	for _, m := range msgs {
		if m["type"] == "error" {
			errMsg = m
			break
		}
	}
	if errMsg == nil {
		t.Fatal("expected error message for unknown type")
	}
	if errMsg["id"] != "bad-1" {
		t.Fatalf("expected error id 'bad-1', got %v", errMsg["id"])
	}
	errObj := errMsg["error"].(map[string]any)
	if errObj["code"] != "bad_request" {
		t.Fatalf("expected bad_request, got %v", errObj["code"])
	}
}

func TestSubscribeBadPathError(t *testing.T) {
	s := NewServer("app", "App")
	s.Register("x", Node{Type: "group"})

	conn := newMockConn()
	s.HandleConnection(conn)

	s.HandleMessage(context.Background(), conn, map[string]any{
		"type": "subscribe",
		"id":   "sub-bad",
		"path": "/nonexistent/deep",
	})

	msgs := conn.Messages()
	var errMsg map[string]any
	for _, m := range msgs {
		if m["type"] == "error" {
			errMsg = m
			break
		}
	}
	if errMsg == nil {
		t.Fatal("expected error message for bad path")
	}
	if errMsg["id"] != "sub-bad" {
		t.Fatalf("expected error id 'sub-bad', got %v", errMsg["id"])
	}
	errObj := errMsg["error"].(map[string]any)
	if errObj["code"] != "not_found" {
		t.Fatalf("expected not_found, got %v", errObj["code"])
	}
}

func TestEmitEvent(t *testing.T) {
	s := NewServer("app", "App")
	conn := newMockConn()
	s.HandleConnection(conn)

	s.EmitEvent("user-navigation", map[string]any{"from": "/a", "to": "/b"})

	msgs := conn.Messages()
	var event map[string]any
	for _, m := range msgs {
		if m["type"] == "event" {
			event = m
			break
		}
	}
	if event == nil {
		t.Fatal("expected event message")
	}
	if event["name"] != "user-navigation" {
		t.Fatalf("expected event name 'user-navigation', got %v", event["name"])
	}
	data := event["data"].(map[string]any)
	if data["from"] != "/a" || data["to"] != "/b" {
		t.Fatalf("unexpected event data: %v", data)
	}
}

func TestQueryWithWindow(t *testing.T) {
	s := NewServer("app", "App")
	children := map[string]Node{}
	for _, name := range []string{"a", "b", "c", "d", "e"} {
		children[name] = Node{Type: "item"}
	}
	s.Register("list", Node{
		Type:     "collection",
		Children: children,
	})

	conn := newMockConn()
	s.HandleConnection(conn)

	// Query with window [1, 2] on the list subtree — skip first, take 2
	s.HandleMessage(context.Background(), conn, map[string]any{
		"type":   "query",
		"id":     "q-win",
		"path":   "/list",
		"depth":  float64(-1),
		"window": []any{float64(1), float64(2)},
	})

	msgs := conn.Messages()
	var snapshot map[string]any
	for _, m := range msgs {
		if m["type"] == "snapshot" && m["id"] == "q-win" {
			snapshot = m
			break
		}
	}
	if snapshot == nil {
		t.Fatal("no snapshot received for windowed query")
	}

	tree := unmarshalWireNode(snapshot["tree"])
	if len(tree.Children) != 2 {
		t.Fatalf("expected 2 children in window, got %d", len(tree.Children))
	}
}
