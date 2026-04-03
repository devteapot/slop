package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"nhooyr.io/websocket"
)

// Client connects to an existing bridge server (e.g., the Desktop app)
// as a consumer. It receives provider announcements and can relay SLOP
// messages through the existing bridge.
type Client struct {
	url              string
	mu               sync.RWMutex
	conn             *websocket.Conn
	providers        map[string]BridgeProvider
	relaySubscribers map[string][]chan map[string]any
	running          bool
	onProviderChange func()
	ctx              context.Context
	cancel           context.CancelFunc
}

func NewClient(port int) *Client {
	return &Client{
		url:              fmt.Sprintf("ws://127.0.0.1:%d/slop-bridge", port),
		providers:        make(map[string]BridgeProvider),
		relaySubscribers: make(map[string][]chan map[string]any),
	}
}

// Connect dials the existing bridge server. Returns an error if it can't connect.
func (c *Client) Connect(ctx context.Context) error {
	c.ctx, c.cancel = context.WithCancel(ctx)

	conn, _, err := websocket.Dial(c.ctx, c.url, nil)
	if err != nil {
		return fmt.Errorf("bridge client connect: %w", err)
	}
	c.conn = conn

	c.mu.Lock()
	c.running = true
	c.mu.Unlock()

	go c.readLoop()
	return nil
}

func (c *Client) Close() {
	if c.cancel != nil {
		c.cancel()
	}
	if c.conn != nil {
		c.conn.Close(websocket.StatusNormalClosure, "")
	}
	c.mu.Lock()
	c.running = false
	c.mu.Unlock()
}

func (c *Client) Running() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.running
}

func (c *Client) Providers() []BridgeProvider {
	c.mu.RLock()
	defer c.mu.RUnlock()
	result := make([]BridgeProvider, 0, len(c.providers))
	for _, p := range c.providers {
		result = append(result, p)
	}
	return result
}

func (c *Client) OnProviderChange(fn func()) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.onProviderChange = fn
}

func (c *Client) SubscribeRelay(providerKey string) chan map[string]any {
	ch := make(chan map[string]any, 64)
	c.mu.Lock()
	c.relaySubscribers[providerKey] = append(c.relaySubscribers[providerKey], ch)
	c.mu.Unlock()
	return ch
}

func (c *Client) UnsubscribeRelay(providerKey string, ch chan map[string]any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	subs := c.relaySubscribers[providerKey]
	for i, sub := range subs {
		if sub == ch {
			c.relaySubscribers[providerKey] = append(subs[:i], subs[i+1:]...)
			break
		}
	}
	if len(c.relaySubscribers[providerKey]) == 0 {
		delete(c.relaySubscribers, providerKey)
	}
	close(ch)
}

func (c *Client) Send(msg map[string]any) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	return c.conn.Write(c.ctx, websocket.MessageText, data)
}

func (c *Client) readLoop() {
	defer func() {
		c.mu.Lock()
		c.running = false
		c.mu.Unlock()
	}()

	for {
		_, data, err := c.conn.Read(c.ctx)
		if err != nil {
			return
		}
		var msg map[string]any
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		c.handleMessage(msg)
	}
}

func (c *Client) handleMessage(msg map[string]any) {
	msgType, _ := msg["type"].(string)

	switch msgType {
	case "provider-available":
		c.handleProviderAvailable(msg)
	case "provider-unavailable":
		c.handleProviderUnavailable(msg)
	case "slop-relay":
		providerKey, _ := msg["providerKey"].(string)
		message, _ := msg["message"].(map[string]any)
		if providerKey != "" && message != nil {
			c.dispatchRelay(providerKey, message)
		}
	}
}

func (c *Client) handleProviderAvailable(msg map[string]any) {
	providerKey, _ := msg["providerKey"].(string)
	if providerKey == "" {
		return
	}

	tabID := 0
	if t, ok := msg["tabId"].(float64); ok {
		tabID = int(t)
	}

	p := BridgeProvider{
		ProviderKey: providerKey,
		TabID:       tabID,
	}

	if provider, ok := msg["provider"].(map[string]any); ok {
		p.ID, _ = provider["id"].(string)
		p.Name, _ = provider["name"].(string)
		p.Transport, _ = provider["transport"].(string)
		p.URL, _ = provider["url"].(string)
	}

	c.mu.Lock()
	c.providers[providerKey] = p
	onChange := c.onProviderChange
	c.mu.Unlock()

	if onChange != nil {
		onChange()
	}
}

func (c *Client) handleProviderUnavailable(msg map[string]any) {
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
}

func (c *Client) dispatchRelay(providerKey string, message map[string]any) {
	c.mu.RLock()
	subs := c.relaySubscribers[providerKey]
	c.mu.RUnlock()

	for _, ch := range subs {
		select {
		case ch <- message:
		default:
		}
	}
}
