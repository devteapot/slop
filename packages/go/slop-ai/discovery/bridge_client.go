package discovery

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"nhooyr.io/websocket"
)

// BridgeClient connects to an existing bridge server and mirrors provider announcements.
type BridgeClient struct {
	url            string
	logger         Logger
	reconnectDelay time.Duration

	mu               sync.RWMutex
	conn             *websocket.Conn
	connCtx          context.Context
	connCancel       context.CancelFunc
	providers        map[string]BridgeProvider
	relaySubscribers map[string][]chan map[string]any
	running          bool
	started          bool
	onProviderChange func()
	ctx              context.Context
	cancel           context.CancelFunc
	reconnectTimer   *time.Timer
}

// NewBridgeClient creates a bridge client for the given URL.
func NewBridgeClient(url string, logger Logger) *BridgeClient {
	return &BridgeClient{
		url:              url,
		logger:           logger,
		reconnectDelay:   defaultBridgeReconnectWait,
		providers:        map[string]BridgeProvider{},
		relaySubscribers: map[string][]chan map[string]any{},
	}
}

// ConnectOnce attempts a single connection to the bridge.
func (c *BridgeClient) ConnectOnce(ctx context.Context) error {
	return c.connect(ctx)
}

// Start enables the reconnect loop and keeps the bridge client running until ctx is cancelled.
func (c *BridgeClient) Start(ctx context.Context) {
	c.mu.Lock()
	if c.started {
		c.mu.Unlock()
		return
	}
	c.ctx, c.cancel = context.WithCancel(ctx)
	c.started = true
	alreadyConnected := c.conn != nil
	c.mu.Unlock()

	if alreadyConnected {
		return
	}

	go c.tryConnect()
}

// Stop closes the bridge client and clears mirrored state.
func (c *BridgeClient) Stop() {
	c.mu.Lock()
	if c.reconnectTimer != nil {
		c.reconnectTimer.Stop()
		c.reconnectTimer = nil
	}
	if c.cancel != nil {
		c.cancel()
		c.cancel = nil
	}
	conn := c.conn
	connCancel := c.connCancel
	providersChanged := len(c.providers) > 0
	for key, subs := range c.relaySubscribers {
		for _, ch := range subs {
			close(ch)
		}
		delete(c.relaySubscribers, key)
	}
	c.providers = map[string]BridgeProvider{}
	c.conn = nil
	c.connCtx = nil
	c.connCancel = nil
	c.running = false
	c.started = false
	onChange := c.onProviderChange
	c.mu.Unlock()

	if connCancel != nil {
		connCancel()
	}
	if conn != nil {
		_ = conn.Close(websocket.StatusNormalClosure, "")
	}
	if providersChanged && onChange != nil {
		onChange()
	}
}

func (c *BridgeClient) Running() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.running
}

func (c *BridgeClient) Providers() []BridgeProvider {
	c.mu.RLock()
	defer c.mu.RUnlock()
	providers := make([]BridgeProvider, 0, len(c.providers))
	for _, provider := range c.providers {
		providers = append(providers, provider)
	}
	return providers
}

func (c *BridgeClient) OnProviderChange(fn func()) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.onProviderChange = fn
}

func (c *BridgeClient) SubscribeRelay(providerKey string) chan map[string]any {
	ch := make(chan map[string]any, 64)
	c.mu.Lock()
	c.relaySubscribers[providerKey] = append(c.relaySubscribers[providerKey], ch)
	c.mu.Unlock()
	return ch
}

func (c *BridgeClient) UnsubscribeRelay(providerKey string, ch chan map[string]any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	subs := c.relaySubscribers[providerKey]
	for index, sub := range subs {
		if sub == ch {
			c.relaySubscribers[providerKey] = append(subs[:index], subs[index+1:]...)
			break
		}
	}
	if len(c.relaySubscribers[providerKey]) == 0 {
		delete(c.relaySubscribers, providerKey)
	}
	close(ch)
}

func (c *BridgeClient) Send(msg map[string]any) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	c.mu.RLock()
	conn := c.conn
	connCtx := c.connCtx
	c.mu.RUnlock()
	if conn == nil || connCtx == nil {
		return fmt.Errorf("bridge client is not connected")
	}

	return conn.Write(connCtx, websocket.MessageText, data)
}

func (c *BridgeClient) connect(ctx context.Context) error {
	c.mu.Lock()
	if c.conn != nil {
		c.mu.Unlock()
		return nil
	}
	c.mu.Unlock()

	conn, _, err := websocket.Dial(ctx, c.url, nil)
	if err != nil {
		return err
	}

	connCtx, connCancel := context.WithCancel(context.Background())

	c.mu.Lock()
	if c.conn != nil {
		c.mu.Unlock()
		connCancel()
		_ = conn.Close(websocket.StatusNormalClosure, "")
		return nil
	}
	c.conn = conn
	c.connCtx = connCtx
	c.connCancel = connCancel
	c.running = true
	c.mu.Unlock()

	c.logger.infof("[slop-bridge] Connected to existing bridge at %s", c.url)
	go c.readLoop(conn, connCtx, connCancel)
	return nil
}

func (c *BridgeClient) tryConnect() {
	c.mu.RLock()
	ctx := c.ctx
	started := c.started
	c.mu.RUnlock()
	if !started || ctx == nil {
		return
	}

	dialCtx, cancel := context.WithTimeout(ctx, defaultBridgeDialTimeout)
	err := c.connect(dialCtx)
	cancel()
	if err != nil {
		c.scheduleReconnect()
	}
}

func (c *BridgeClient) scheduleReconnect() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.started || c.ctx == nil || c.ctx.Err() != nil || c.reconnectTimer != nil {
		return
	}
	c.reconnectTimer = time.AfterFunc(c.reconnectDelay, func() {
		c.mu.Lock()
		c.reconnectTimer = nil
		c.mu.Unlock()
		c.tryConnect()
	})
}

func (c *BridgeClient) readLoop(conn *websocket.Conn, connCtx context.Context, connCancel context.CancelFunc) {
	defer connCancel()
	for {
		_, data, err := conn.Read(connCtx)
		if err != nil {
			c.handleDisconnect(conn)
			return
		}
		var msg map[string]any
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		c.handleMessage(msg)
	}
}

func (c *BridgeClient) handleDisconnect(conn *websocket.Conn) {
	c.mu.Lock()
	if c.conn != conn {
		c.mu.Unlock()
		return
	}
	c.conn = nil
	c.connCtx = nil
	c.connCancel = nil
	providersChanged := len(c.providers) > 0
	c.providers = map[string]BridgeProvider{}
	for key, subs := range c.relaySubscribers {
		for _, ch := range subs {
			close(ch)
		}
		delete(c.relaySubscribers, key)
	}
	c.running = false
	started := c.started
	onChange := c.onProviderChange
	c.mu.Unlock()

	if providersChanged && onChange != nil {
		onChange()
	}
	if started {
		c.scheduleReconnect()
	}
}

func (c *BridgeClient) handleMessage(msg map[string]any) {
	msgType, _ := msg["type"].(string)

	switch msgType {
	case "provider-available":
		provider, ok := parseBridgeProvider(msg)
		if !ok {
			return
		}
		c.mu.Lock()
		c.providers[provider.ProviderKey] = provider
		onChange := c.onProviderChange
		c.mu.Unlock()
		if onChange != nil {
			onChange()
		}

	case "provider-unavailable":
		providerKey, _ := msg["providerKey"].(string)
		if providerKey == "" {
			return
		}
		c.mu.Lock()
		delete(c.providers, providerKey)
		if subs, ok := c.relaySubscribers[providerKey]; ok {
			for _, ch := range subs {
				close(ch)
			}
			delete(c.relaySubscribers, providerKey)
		}
		onChange := c.onProviderChange
		c.mu.Unlock()
		if onChange != nil {
			onChange()
		}

	case "slop-relay":
		providerKey, _ := msg["providerKey"].(string)
		message, _ := msg["message"].(map[string]any)
		if providerKey == "" || message == nil {
			return
		}
		c.dispatchRelay(providerKey, message)
	}
}

func (c *BridgeClient) dispatchRelay(providerKey string, message map[string]any) {
	c.mu.RLock()
	subs := append([]chan map[string]any(nil), c.relaySubscribers[providerKey]...)
	c.mu.RUnlock()

	for _, ch := range subs {
		select {
		case ch <- message:
		default:
		}
	}
}
