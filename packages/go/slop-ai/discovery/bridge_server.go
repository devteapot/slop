package discovery

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"sync"

	"nhooyr.io/websocket"
)

type wsSink struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (s *wsSink) write(ctx context.Context, payload []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.conn.Write(ctx, websocket.MessageText, payload)
}

// BridgeServer hosts the extension bridge and mirrors bridge providers for local consumers.
type BridgeServer struct {
	addr   string
	path   string
	logger Logger

	mu               sync.RWMutex
	providers        map[string]BridgeProvider
	relaySubscribers map[string][]chan map[string]any
	sinks            map[*wsSink]struct{}
	httpServer       *http.Server
	listener         net.Listener
	actualAddr       string
	running          bool
	onProviderChange func()
	cancel           context.CancelFunc
	ctx              context.Context
}

// NewBridgeServer creates a new bridge server.
func NewBridgeServer(addr, path string, logger Logger) *BridgeServer {
	return &BridgeServer{
		addr:             addr,
		path:             path,
		logger:           logger,
		providers:        map[string]BridgeProvider{},
		relaySubscribers: map[string][]chan map[string]any{},
		sinks:            map[*wsSink]struct{}{},
	}
}

// Start binds the bridge server and begins serving in the background.
func (s *BridgeServer) Start(ctx context.Context) error {
	mux := http.NewServeMux()
	mux.HandleFunc(s.path, s.handleUpgrade)

	listener, err := net.Listen("tcp", s.addr)
	if err != nil {
		return err
	}

	serverCtx, cancel := context.WithCancel(ctx)
	httpServer := &http.Server{Handler: mux}

	s.mu.Lock()
	s.listener = listener
	s.actualAddr = listener.Addr().String()
	s.ctx = serverCtx
	s.cancel = cancel
	s.httpServer = httpServer
	s.running = true
	s.mu.Unlock()

	go func() {
		<-serverCtx.Done()
		_ = httpServer.Close()
	}()

	go func() {
		err := httpServer.Serve(listener)
		if err != nil && err != http.ErrServerClosed {
			s.logger.errorf("[slop-bridge] Server error: %v", err)
		}
	}()

	s.logger.infof("[slop-bridge] Bridge server running on %s", s.URL())
	return nil
}

// URL returns the current bridge URL.
func (s *BridgeServer) URL() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	addr := s.actualAddr
	if addr == "" {
		addr = s.addr
	}
	return fmt.Sprintf("ws://%s%s", addr, s.path)
}

func (s *BridgeServer) Stop() {
	s.mu.Lock()
	if s.cancel != nil {
		s.cancel()
	}
	listener := s.listener
	httpServer := s.httpServer
	s.running = false
	s.listener = nil
	s.httpServer = nil
	providersChanged := len(s.providers) > 0
	for key, subs := range s.relaySubscribers {
		for _, ch := range subs {
			close(ch)
		}
		delete(s.relaySubscribers, key)
	}
	s.providers = map[string]BridgeProvider{}
	sinks := make([]*wsSink, 0, len(s.sinks))
	for sink := range s.sinks {
		sinks = append(sinks, sink)
		delete(s.sinks, sink)
	}
	onChange := s.onProviderChange
	s.mu.Unlock()

	if listener != nil {
		_ = listener.Close()
	}
	if httpServer != nil {
		_ = httpServer.Close()
	}
	for _, sink := range sinks {
		_ = sink.conn.Close(websocket.StatusNormalClosure, "")
	}
	if providersChanged && onChange != nil {
		onChange()
	}
}

func (s *BridgeServer) Running() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.running
}

func (s *BridgeServer) Providers() []BridgeProvider {
	s.mu.RLock()
	defer s.mu.RUnlock()
	providers := make([]BridgeProvider, 0, len(s.providers))
	for _, provider := range s.providers {
		providers = append(providers, provider)
	}
	return providers
}

func (s *BridgeServer) OnProviderChange(fn func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onProviderChange = fn
}

func (s *BridgeServer) SubscribeRelay(providerKey string) chan map[string]any {
	ch := make(chan map[string]any, 64)
	s.mu.Lock()
	s.relaySubscribers[providerKey] = append(s.relaySubscribers[providerKey], ch)
	s.mu.Unlock()
	return ch
}

func (s *BridgeServer) UnsubscribeRelay(providerKey string, ch chan map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	subs := s.relaySubscribers[providerKey]
	for index, sub := range subs {
		if sub == ch {
			s.relaySubscribers[providerKey] = append(subs[:index], subs[index+1:]...)
			break
		}
	}
	if len(s.relaySubscribers[providerKey]) == 0 {
		delete(s.relaySubscribers, providerKey)
	}
	close(ch)
}

func (s *BridgeServer) Send(msg map[string]any) error {
	return s.broadcast(msg)
}

func (s *BridgeServer) broadcast(msg map[string]any) error {
	payload, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	s.mu.RLock()
	ctx := s.ctx
	sinks := make([]*wsSink, 0, len(s.sinks))
	for sink := range s.sinks {
		sinks = append(sinks, sink)
	}
	s.mu.RUnlock()
	if ctx == nil {
		ctx = context.Background()
	}

	for _, sink := range sinks {
		if err := sink.write(ctx, payload); err != nil {
			s.logger.errorf("[slop-bridge] Broadcast failed: %v", err)
		}
	}
	return nil
}

func (s *BridgeServer) handleUpgrade(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}

	sink := &wsSink{conn: conn}
	s.addConn(sink)
	defer s.removeConn(sink)

	s.readLoop(sink)
}

func (s *BridgeServer) addConn(sink *wsSink) {
	s.mu.Lock()
	s.sinks[sink] = struct{}{}
	providers := make([]BridgeProvider, 0, len(s.providers))
	for _, provider := range s.providers {
		providers = append(providers, provider)
	}
	ctx := s.ctx
	s.mu.Unlock()

	if ctx == nil {
		ctx = context.Background()
	}

	for _, provider := range providers {
		message := map[string]any{
			"type":        "provider-available",
			"tabId":       provider.TabID,
			"providerKey": provider.ProviderKey,
			"provider": map[string]any{
				"id":        provider.ID,
				"name":      provider.Name,
				"transport": provider.Transport,
			},
		}
		if provider.URL != "" {
			message["provider"].(map[string]any)["url"] = provider.URL
		}
		payload, err := json.Marshal(message)
		if err != nil {
			continue
		}
		_ = sink.write(ctx, payload)
	}
}

func (s *BridgeServer) removeConn(sink *wsSink) {
	s.mu.Lock()
	delete(s.sinks, sink)
	noSinks := len(s.sinks) == 0
	providersChanged := false
	if noSinks {
		if len(s.providers) > 0 {
			providersChanged = true
		}
		for key, subs := range s.relaySubscribers {
			for _, ch := range subs {
				close(ch)
			}
			delete(s.relaySubscribers, key)
		}
		s.providers = map[string]BridgeProvider{}
	}
	onChange := s.onProviderChange
	s.mu.Unlock()

	_ = sink.conn.Close(websocket.StatusNormalClosure, "")
	if providersChanged && onChange != nil {
		onChange()
	}
}

func (s *BridgeServer) readLoop(sink *wsSink) {
	for {
		s.mu.RLock()
		ctx := s.ctx
		s.mu.RUnlock()
		if ctx == nil {
			ctx = context.Background()
		}

		_, data, err := sink.conn.Read(ctx)
		if err != nil {
			return
		}

		var msg map[string]any
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		s.handleMessage(msg)
	}
}

func (s *BridgeServer) handleMessage(msg map[string]any) {
	msgType, _ := msg["type"].(string)

	switch msgType {
	case "provider-available":
		provider, ok := parseBridgeProvider(msg)
		if !ok {
			return
		}
		s.mu.Lock()
		s.providers[provider.ProviderKey] = provider
		onChange := s.onProviderChange
		s.mu.Unlock()
		_ = s.broadcast(msg)
		if onChange != nil {
			onChange()
		}

	case "provider-unavailable":
		providerKey, _ := msg["providerKey"].(string)
		if providerKey == "" {
			return
		}
		s.mu.Lock()
		delete(s.providers, providerKey)
		if subs, ok := s.relaySubscribers[providerKey]; ok {
			for _, ch := range subs {
				close(ch)
			}
			delete(s.relaySubscribers, providerKey)
		}
		onChange := s.onProviderChange
		s.mu.Unlock()
		_ = s.broadcast(msg)
		if onChange != nil {
			onChange()
		}

	case "slop-relay":
		providerKey, _ := msg["providerKey"].(string)
		message, _ := msg["message"].(map[string]any)
		if providerKey == "" || message == nil {
			return
		}
		s.dispatchRelay(providerKey, message)
		_ = s.broadcast(msg)

	case "relay-open", "relay-close":
		_ = s.broadcast(msg)
	}
}

func (s *BridgeServer) dispatchRelay(providerKey string, message map[string]any) {
	s.mu.RLock()
	subs := append([]chan map[string]any(nil), s.relaySubscribers[providerKey]...)
	s.mu.RUnlock()

	for _, ch := range subs {
		select {
		case ch <- message:
		default:
		}
	}
}
