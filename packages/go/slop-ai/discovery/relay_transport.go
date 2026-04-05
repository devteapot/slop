package discovery

import (
	"context"
	"sync"
	"time"

	slop "github.com/devteapot/slop/packages/go/slop-ai"
)

const (
	relayRetryDelay = 300 * time.Millisecond
	relayMaxRetries = 3
)

// BridgeRelayTransport routes SLOP messages through the extension bridge.
type BridgeRelayTransport struct {
	Bridge      Bridge
	ProviderKey string
}

// Connect opens a relay connection through the bridge.
func (t *BridgeRelayTransport) Connect(ctx context.Context) (slop.ClientConnection, error) {
	relayCh := t.Bridge.SubscribeRelay(t.ProviderKey)

	if err := t.Bridge.Send(map[string]any{
		"type":        "relay-open",
		"providerKey": t.ProviderKey,
	}); err != nil {
		t.Bridge.UnsubscribeRelay(t.ProviderKey, relayCh)
		return nil, err
	}

	rc := &relayConn{
		bridge:      t.Bridge,
		providerKey: t.ProviderKey,
		relayCh:     relayCh,
		done:        make(chan struct{}),
		buffering:   true,
	}
	go rc.readLoop()

	var (
		gotResponse bool
		seenMu      sync.Mutex
	)
	markResponse := func(map[string]any) {
		seenMu.Lock()
		gotResponse = true
		seenMu.Unlock()
	}
	rc.addMessageHandler(markResponse)

	for attempt := 0; attempt <= relayMaxRetries; attempt++ {
		if err := t.Bridge.Send(map[string]any{
			"type":        "slop-relay",
			"providerKey": t.ProviderKey,
			"message": map[string]any{
				"type": "connect",
			},
		}); err != nil {
			rc.Close()
			return nil, err
		}

		seenMu.Lock()
		seen := gotResponse
		seenMu.Unlock()
		if seen {
			break
		}

		select {
		case <-ctx.Done():
			rc.Close()
			return nil, ctx.Err()
		case <-time.After(relayRetryDelay):
		}
	}

	return rc, nil
}

type relayConn struct {
	bridge      Bridge
	providerKey string
	relayCh     chan map[string]any

	mu              sync.Mutex
	messageHandlers []func(map[string]any)
	closeHandlers   []func()
	earlyMessages   []map[string]any
	buffering       bool
	closed          bool
	done            chan struct{}
}

func (rc *relayConn) Send(msg map[string]any) error {
	rc.mu.Lock()
	closed := rc.closed
	rc.mu.Unlock()
	if closed {
		return nil
	}

	return rc.bridge.Send(map[string]any{
		"type":        "slop-relay",
		"providerKey": rc.providerKey,
		"message":     msg,
	})
}

func (rc *relayConn) OnMessage(handler func(map[string]any)) {
	rc.mu.Lock()
	rc.messageHandlers = append(rc.messageHandlers, handler)
	earlyMessages := append([]map[string]any(nil), rc.earlyMessages...)
	if rc.buffering {
		rc.buffering = false
		rc.earlyMessages = nil
	}
	rc.mu.Unlock()

	for _, msg := range earlyMessages {
		handler(msg)
	}
}

func (rc *relayConn) OnClose(handler func()) {
	rc.mu.Lock()
	defer rc.mu.Unlock()
	rc.closeHandlers = append(rc.closeHandlers, handler)
}

func (rc *relayConn) Close() error {
	rc.mu.Lock()
	if rc.closed {
		rc.mu.Unlock()
		return nil
	}
	rc.closed = true
	closeHandlers := append([]func(){}, rc.closeHandlers...)
	rc.closeHandlers = nil
	rc.mu.Unlock()

	_ = rc.bridge.Send(map[string]any{
		"type":        "relay-close",
		"providerKey": rc.providerKey,
	})
	rc.bridge.UnsubscribeRelay(rc.providerKey, rc.relayCh)
	close(rc.done)

	for _, handler := range closeHandlers {
		handler()
	}
	return nil
}

func (rc *relayConn) readLoop() {
	for {
		select {
		case msg, ok := <-rc.relayCh:
			if !ok {
				rc.fireClose()
				return
			}
			rc.dispatchMessage(msg)
		case <-rc.done:
			return
		}
	}
}

func (rc *relayConn) dispatchMessage(msg map[string]any) {
	rc.mu.Lock()
	if rc.buffering {
		rc.earlyMessages = append(rc.earlyMessages, msg)
	}
	handlers := append([]func(map[string]any){}, rc.messageHandlers...)
	rc.mu.Unlock()

	for _, handler := range handlers {
		handler(msg)
	}
}

func (rc *relayConn) fireClose() {
	rc.mu.Lock()
	if rc.closed {
		rc.mu.Unlock()
		return
	}
	rc.closed = true
	handlers := append([]func(){}, rc.closeHandlers...)
	rc.closeHandlers = nil
	rc.mu.Unlock()

	for _, handler := range handlers {
		handler()
	}
}

func (rc *relayConn) addMessageHandler(handler func(map[string]any)) {
	rc.mu.Lock()
	rc.messageHandlers = append(rc.messageHandlers, handler)
	rc.mu.Unlock()
}
