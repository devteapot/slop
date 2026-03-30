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
	s.HandleMessage(conn, map[string]any{"type": "subscribe", "id": "sub-1"})
	msgs = conn.Messages()
	if msgs[1]["type"] != "snapshot" {
		t.Fatalf("expected snapshot, got %v", msgs[1]["type"])
	}

	// Query
	s.HandleMessage(conn, map[string]any{"type": "query", "id": "q-1"})
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
	s.HandleMessage(conn, map[string]any{
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
	s.HandleMessage(conn, map[string]any{
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
	s.HandleMessage(conn, map[string]any{"type": "subscribe", "id": "sub-1"})
	initial := len(conn.Messages())

	s.Register("x", Node{Type: "group", Props: Props{"v": 2}})
	if len(conn.Messages()) <= initial {
		t.Fatal("expected broadcast after change")
	}
}
