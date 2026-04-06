package discovery

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"nhooyr.io/websocket"
)

func TestServiceScansAndPrunesDescriptors(t *testing.T) {
	t.Parallel()

	providersDir := t.TempDir()
	descriptorPath := filepath.Join(providersDir, "test-app.json")
	descriptor := `{
		"id": "test-app",
		"name": "Test App",
		"slop_version": "0.1",
		"transport": {"type": "unix", "path": "/tmp/slop/test-app.sock"},
		"capabilities": ["state"]
	}`
	if err := os.WriteFile(descriptorPath, []byte(descriptor), 0o644); err != nil {
		t.Fatalf("write descriptor: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	service := NewService(ServiceOptions{
		ProvidersDirs:     []string{providersDir},
		BridgeURL:         "ws://127.0.0.1:1/slop-bridge",
		BridgeAddr:        "127.0.0.1:0",
		BridgePath:        "/slop-bridge",
		BridgeDialTimeout: 20 * time.Millisecond,
		ScanInterval:      20 * time.Millisecond,
		WatchDebounce:     10 * time.Millisecond,
	})
	service.Start(ctx)
	defer service.Stop()

	waitUntil(t, time.Second, func() bool {
		return len(service.GetDiscovered()) == 1
	})

	if err := os.Remove(descriptorPath); err != nil {
		t.Fatalf("remove descriptor: %v", err)
	}

	waitUntil(t, time.Second, func() bool {
		return len(service.GetDiscovered()) == 0
	})
}

func TestBridgeServerForwardsRelayControlMessages(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	server := NewBridgeServer("127.0.0.1:0", "/slop-bridge", Logger{})
	if err := server.Start(ctx); err != nil {
		t.Fatalf("start bridge server: %v", err)
	}
	defer server.Stop()

	clientOne, _, err := websocket.Dial(ctx, server.URL(), nil)
	if err != nil {
		t.Fatalf("dial client one: %v", err)
	}
	defer clientOne.Close(websocket.StatusNormalClosure, "")

	clientTwo, _, err := websocket.Dial(ctx, server.URL(), nil)
	if err != nil {
		t.Fatalf("dial client two: %v", err)
	}
	defer clientTwo.Close(websocket.StatusNormalClosure, "")

	openMessage := map[string]any{"type": "relay-open", "providerKey": "browser-tab"}
	if err := writeWSJSON(ctx, clientOne, openMessage); err != nil {
		t.Fatalf("write relay-open: %v", err)
	}

	message := readWSJSON(t, ctx, clientTwo)
	if message["type"] != "relay-open" {
		t.Fatalf("expected relay-open broadcast, got %#v", message)
	}

	closeMessage := map[string]any{"type": "relay-close", "providerKey": "browser-tab"}
	if err := writeWSJSON(ctx, clientOne, closeMessage); err != nil {
		t.Fatalf("write relay-close: %v", err)
	}

	message = readWSJSON(t, ctx, clientTwo)
	if message["type"] != "relay-close" {
		t.Fatalf("expected relay-close broadcast, got %#v", message)
	}
}

func TestRelayTransportBuffersEarlyMessages(t *testing.T) {
	t.Parallel()

	bridge := &fakeBridge{}
	transport := &BridgeRelayTransport{Bridge: bridge, ProviderKey: "tab-1"}

	conn, err := transport.Connect(context.Background())
	if err != nil {
		t.Fatalf("connect relay transport: %v", err)
	}
	defer conn.Close()

	got := make(chan map[string]any, 1)
	conn.OnMessage(func(msg map[string]any) {
		got <- msg
	})

	select {
	case msg := <-got:
		if msg["type"] != "hello" {
			t.Fatalf("expected buffered hello message, got %#v", msg)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for buffered relay message")
	}
}

func waitUntil(t *testing.T, timeout time.Duration, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("condition not met before timeout")
}

func writeWSJSON(ctx context.Context, conn *websocket.Conn, value map[string]any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageText, payload)
}

func readWSJSON(t *testing.T, ctx context.Context, conn *websocket.Conn) map[string]any {
	t.Helper()
	readCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	_, payload, err := conn.Read(readCtx)
	if err != nil {
		t.Fatalf("read websocket message: %v", err)
	}
	var message map[string]any
	if err := json.Unmarshal(payload, &message); err != nil {
		t.Fatalf("decode websocket message: %v", err)
	}
	return message
}

type fakeBridge struct {
	mu   sync.Mutex
	subs map[string][]chan map[string]any
	msgs []map[string]any
}

func (b *fakeBridge) Running() bool { return true }

func (b *fakeBridge) Providers() []BridgeProvider { return nil }

func (b *fakeBridge) OnProviderChange(func()) {}

func (b *fakeBridge) SubscribeRelay(providerKey string) chan map[string]any {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.subs == nil {
		b.subs = map[string][]chan map[string]any{}
	}
	ch := make(chan map[string]any, 8)
	b.subs[providerKey] = append(b.subs[providerKey], ch)
	return ch
}

func (b *fakeBridge) UnsubscribeRelay(providerKey string, ch chan map[string]any) {
	b.mu.Lock()
	defer b.mu.Unlock()
	subs := b.subs[providerKey]
	for index, sub := range subs {
		if sub == ch {
			b.subs[providerKey] = append(subs[:index], subs[index+1:]...)
			break
		}
	}
	close(ch)
}

func (b *fakeBridge) Send(msg map[string]any) error {
	b.mu.Lock()
	b.msgs = append(b.msgs, msg)
	var subs []chan map[string]any
	if msg["type"] == "slop-relay" {
		if message, ok := msg["message"].(map[string]any); ok && message["type"] == "connect" {
			providerKey, _ := msg["providerKey"].(string)
			subs = append(subs, b.subs[providerKey]...)
		}
	}
	b.mu.Unlock()

	for _, ch := range subs {
		ch <- map[string]any{"type": "hello", "provider": map[string]any{"name": "Browser App"}}
	}
	return nil
}

func (b *fakeBridge) Stop() {}
