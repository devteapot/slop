package bridge

import (
	"context"
	"sync"

	slop "github.com/devteapot/slop/packages/go/slop-ai"
)

// RelayTransport implements slop.ClientTransport for bridge-relayed providers.
// It allows slop.Consumer to communicate with a postMessage provider through
// the bridge (either a local Server or a remote Client connection).
type RelayTransport struct {
	Bridge      Bridge
	ProviderKey string
}

// Connect opens a relay connection through the bridge.
func (t *RelayTransport) Connect(ctx context.Context) (slop.ClientConnection, error) {
	// Subscribe to relay messages for this provider
	relayCh := t.Bridge.SubscribeRelay(t.ProviderKey)

	// Tell the extension to start relaying for this provider
	err := t.Bridge.Send(map[string]any{
		"type":        "relay-open",
		"providerKey": t.ProviderKey,
	})
	if err != nil {
		t.Bridge.UnsubscribeRelay(t.ProviderKey, relayCh)
		return nil, err
	}

	rc := &relayConn{
		bridge:      t.Bridge,
		providerKey: t.ProviderKey,
		relayCh:     relayCh,
		done:        make(chan struct{}),
	}

	go rc.readLoop()

	return rc, nil
}

// relayConn implements slop.ClientConnection by relaying messages through the bridge.
type relayConn struct {
	bridge       Bridge
	providerKey  string
	relayCh      chan map[string]any
	mu           sync.Mutex
	msgHandler   func(map[string]any)
	closeHandler func()
	done         chan struct{}
	closed       bool
}

func (rc *relayConn) Send(msg map[string]any) error {
	return rc.bridge.Send(map[string]any{
		"type":        "slop-relay",
		"providerKey": rc.providerKey,
		"message":     msg,
	})
}

func (rc *relayConn) OnMessage(handler func(map[string]any)) {
	rc.mu.Lock()
	defer rc.mu.Unlock()
	rc.msgHandler = handler
}

func (rc *relayConn) OnClose(handler func()) {
	rc.mu.Lock()
	defer rc.mu.Unlock()
	rc.closeHandler = handler
}

func (rc *relayConn) Close() error {
	rc.mu.Lock()
	if rc.closed {
		rc.mu.Unlock()
		return nil
	}
	rc.closed = true
	rc.mu.Unlock()

	// Tell the extension to stop relaying
	rc.bridge.Send(map[string]any{
		"type":        "relay-close",
		"providerKey": rc.providerKey,
	})

	rc.bridge.UnsubscribeRelay(rc.providerKey, rc.relayCh)
	close(rc.done)
	return nil
}

func (rc *relayConn) readLoop() {
	defer func() {
		rc.mu.Lock()
		handler := rc.closeHandler
		rc.mu.Unlock()
		if handler != nil {
			handler()
		}
	}()

	for {
		select {
		case msg, ok := <-rc.relayCh:
			if !ok {
				// Channel closed (provider gone or extension disconnected)
				return
			}
			rc.mu.Lock()
			handler := rc.msgHandler
			rc.mu.Unlock()
			if handler != nil {
				handler(msg)
			}
		case <-rc.done:
			return
		}
	}
}
