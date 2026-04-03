package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"sync"

	"nhooyr.io/websocket"
)

const DefaultPort = 9339

// BridgeProvider represents a provider announced by the browser extension.
type BridgeProvider struct {
	ProviderKey string
	TabID       int
	ID          string
	Name        string
	Transport   string // "ws" or "postmessage"
	URL         string
}

// Server is a WebSocket bridge server that the browser extension connects to.
// It receives provider announcements and relays SLOP messages for postMessage providers.
type Server struct {
	port             int
	mu               sync.RWMutex
	providers        map[string]BridgeProvider
	relaySubscribers map[string][]chan map[string]any
	conns            []*websocket.Conn
	httpServer       *http.Server
	running          bool
	portInUse        bool
	onProviderChange func()
	ctx              context.Context
	cancel           context.CancelFunc
}

func NewServer(port int) *Server {
	return &Server{
		port:             port,
		providers:        make(map[string]BridgeProvider),
		relaySubscribers: make(map[string][]chan map[string]any),
	}
}

// Start begins listening for extension WebSocket connections. Returns an error
// if the port is already in use (e.g., the Desktop app is running).
func (s *Server) Start(ctx context.Context) error {
	s.ctx, s.cancel = context.WithCancel(ctx)

	mux := http.NewServeMux()
	mux.HandleFunc("/slop-bridge", s.handleUpgrade)

	addr := fmt.Sprintf("127.0.0.1:%d", s.port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		s.mu.Lock()
		s.portInUse = true
		s.mu.Unlock()
		return fmt.Errorf("port %d in use", s.port)
	}

	s.httpServer = &http.Server{Handler: mux}

	s.mu.Lock()
	s.running = true
	s.mu.Unlock()

	go func() {
		<-s.ctx.Done()
		s.httpServer.Close()
	}()

	err = s.httpServer.Serve(listener)
	if err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

func (s *Server) Stop() {
	if s.cancel != nil {
		s.cancel()
	}
	s.mu.Lock()
	s.running = false
	s.mu.Unlock()
}

// Close implements Bridge.
func (s *Server) Close() { s.Stop() }

// Send implements Bridge by broadcasting to all connected extensions.
func (s *Server) Send(msg map[string]any) error { return s.SendToExtension(msg) }

func (s *Server) Running() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.running
}

func (s *Server) PortInUse() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.portInUse
}

func (s *Server) Port() int {
	return s.port
}

// ConnectedExtensions returns the number of connected extension WebSockets.
func (s *Server) ConnectedExtensions() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.conns)
}

// Providers returns a snapshot of currently announced bridge providers.
func (s *Server) Providers() []BridgeProvider {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]BridgeProvider, 0, len(s.providers))
	for _, p := range s.providers {
		result = append(result, p)
	}
	return result
}

// OnProviderChange registers a callback fired when bridge providers change.
func (s *Server) OnProviderChange(fn func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onProviderChange = fn
}

// SubscribeRelay returns a channel that receives relay messages for the given provider key.
func (s *Server) SubscribeRelay(providerKey string) chan map[string]any {
	ch := make(chan map[string]any, 64)
	s.mu.Lock()
	s.relaySubscribers[providerKey] = append(s.relaySubscribers[providerKey], ch)
	s.mu.Unlock()
	return ch
}

// UnsubscribeRelay removes a relay channel for the given provider key.
func (s *Server) UnsubscribeRelay(providerKey string, ch chan map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	subs := s.relaySubscribers[providerKey]
	for i, sub := range subs {
		if sub == ch {
			s.relaySubscribers[providerKey] = append(subs[:i], subs[i+1:]...)
			break
		}
	}
	if len(s.relaySubscribers[providerKey]) == 0 {
		delete(s.relaySubscribers, providerKey)
	}
	close(ch)
}

// SendToExtension broadcasts a JSON message to all connected extension WebSockets.
func (s *Server) SendToExtension(msg map[string]any) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	s.mu.RLock()
	conns := make([]*websocket.Conn, len(s.conns))
	copy(conns, s.conns)
	s.mu.RUnlock()

	for _, c := range conns {
		c.Write(s.ctx, websocket.MessageText, data)
	}
	return nil
}

func (s *Server) handleUpgrade(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true, // localhost only
	})
	if err != nil {
		return
	}

	s.addConn(c)
	defer s.removeConn(c)

	s.readLoop(c)
}

func (s *Server) addConn(c *websocket.Conn) {
	s.mu.Lock()
	s.conns = append(s.conns, c)
	// Snapshot current providers to replay
	providers := make([]BridgeProvider, 0, len(s.providers))
	for _, p := range s.providers {
		providers = append(providers, p)
	}
	s.mu.Unlock()

	// Replay already-known bridge providers to the new client
	for _, p := range providers {
		providerObj := map[string]any{
			"id":        p.ID,
			"name":      p.Name,
			"transport": p.Transport,
		}
		if p.URL != "" {
			providerObj["url"] = p.URL
		}
		msg := map[string]any{
			"type":        "provider-available",
			"tabId":       p.TabID,
			"providerKey": p.ProviderKey,
			"provider":    providerObj,
		}
		data, err := json.Marshal(msg)
		if err == nil {
			c.Write(s.ctx, websocket.MessageText, data)
		}
	}
}

func (s *Server) removeConn(c *websocket.Conn) {
	s.mu.Lock()
	for i, conn := range s.conns {
		if conn == c {
			s.conns = append(s.conns[:i], s.conns[i+1:]...)
			break
		}
	}
	noConns := len(s.conns) == 0
	s.mu.Unlock()

	if noConns {
		s.clearAllRelays()
	}
}

func (s *Server) readLoop(c *websocket.Conn) {
	for {
		_, data, err := c.Read(s.ctx)
		if err != nil {
			return
		}
		var msg map[string]any
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		s.handleMessage(msg)
	}
}

func (s *Server) handleMessage(msg map[string]any) {
	msgType, _ := msg["type"].(string)

	switch msgType {
	case "provider-available":
		s.handleProviderAvailable(msg)
	case "provider-unavailable":
		s.handleProviderUnavailable(msg)
	case "slop-relay":
		providerKey, _ := msg["providerKey"].(string)
		message, _ := msg["message"].(map[string]any)
		if providerKey != "" && message != nil {
			s.dispatchRelay(providerKey, message)
		}
	}
}

func (s *Server) handleProviderAvailable(msg map[string]any) {
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

	s.mu.Lock()
	s.providers[providerKey] = p
	onChange := s.onProviderChange
	s.mu.Unlock()

	// Rebroadcast so other bridge consumers (e.g. CLI client mode) receive it
	s.SendToExtension(msg)

	if onChange != nil {
		onChange()
	}
}

func (s *Server) handleProviderUnavailable(msg map[string]any) {
	providerKey, _ := msg["providerKey"].(string)
	if providerKey == "" {
		return
	}

	s.mu.Lock()
	delete(s.providers, providerKey)
	// Close relay subscribers for this provider
	if subs, ok := s.relaySubscribers[providerKey]; ok {
		for _, ch := range subs {
			close(ch)
		}
		delete(s.relaySubscribers, providerKey)
	}
	onChange := s.onProviderChange
	s.mu.Unlock()

	// Rebroadcast so other bridge consumers receive it
	s.SendToExtension(msg)

	if onChange != nil {
		onChange()
	}
}

func (s *Server) dispatchRelay(providerKey string, message map[string]any) {
	s.mu.RLock()
	subs := s.relaySubscribers[providerKey]
	s.mu.RUnlock()

	for _, ch := range subs {
		select {
		case ch <- message:
		default:
			// Drop if channel is full
		}
	}
}

func (s *Server) clearAllRelays() {
	s.mu.Lock()
	for key, subs := range s.relaySubscribers {
		for _, ch := range subs {
			close(ch)
		}
		delete(s.relaySubscribers, key)
	}
	s.mu.Unlock()
}
