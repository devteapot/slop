package discovery

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	slop "github.com/devteapot/slop/packages/go/slop-ai"
	"github.com/fsnotify/fsnotify"
)

var validTransportTypes = map[string]struct{}{
	"unix":  {},
	"ws":    {},
	"stdio": {},
	"relay": {},
}

// Service manages provider discovery and connections.
type Service struct {
	config serviceConfig

	mu                sync.RWMutex
	providers         map[string]*ConnectedProvider
	localDescriptors  []ProviderDescriptor
	lastAccessed      map[string]time.Time
	reconnectAttempts map[string]int
	suppressReconnect map[string]bool
	bridge            Bridge
	stateChange       func()
	started           bool
	ctx               context.Context
	cancel            context.CancelFunc
	watcher           *fsnotify.Watcher
	watchDebounce     *time.Timer
	watchedDirs       map[string]struct{}

	scanMu sync.Mutex
}

// NewService creates a discovery service.
func NewService(opts ServiceOptions) *Service {
	return &Service{
		config:            normalizeOptions(opts),
		providers:         map[string]*ConnectedProvider{},
		lastAccessed:      map[string]time.Time{},
		reconnectAttempts: map[string]int{},
		suppressReconnect: map[string]bool{},
		watchedDirs:       map[string]struct{}{},
	}
}

// Start begins scanning directories, watching for changes, and managing the bridge.
func (s *Service) Start(ctx context.Context) {
	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return
	}
	s.ctx, s.cancel = context.WithCancel(ctx)
	s.started = true
	s.mu.Unlock()

	watcher, err := fsnotify.NewWatcher()
	if err == nil {
		s.mu.Lock()
		s.watcher = watcher
		s.mu.Unlock()
		go s.watchLoop(watcher)
	} else {
		s.config.logger.errorf("[slop] Failed to start discovery watcher: %v", err)
	}

	s.scan()
	go s.scanTickerLoop()
	go s.idleTickerLoop()
	go s.initBridge()
}

// Stop shuts down the service and disconnects all providers.
func (s *Service) Stop() {
	s.mu.Lock()
	if !s.started {
		s.mu.Unlock()
		return
	}
	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}
	if s.watchDebounce != nil {
		s.watchDebounce.Stop()
		s.watchDebounce = nil
	}
	watcher := s.watcher
	s.watcher = nil
	bridge := s.bridge
	s.bridge = nil
	providers := make([]*ConnectedProvider, 0, len(s.providers))
	for id, provider := range s.providers {
		s.suppressReconnect[id] = true
		providers = append(providers, provider)
	}
	s.providers = map[string]*ConnectedProvider{}
	s.lastAccessed = map[string]time.Time{}
	s.reconnectAttempts = map[string]int{}
	s.started = false
	s.mu.Unlock()

	if watcher != nil {
		_ = watcher.Close()
	}
	if bridge != nil {
		bridge.Stop()
	}
	for _, provider := range providers {
		provider.Consumer.Disconnect()
	}
}

// OnStateChange registers a callback fired on provider connect, disconnect, and state patch.
func (s *Service) OnStateChange(fn func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stateChange = fn
}

// GetDiscovered returns all currently known provider descriptors.
func (s *Service) GetDiscovered() []ProviderDescriptor {
	s.mu.RLock()
	local := append([]ProviderDescriptor(nil), s.localDescriptors...)
	bridge := s.bridge
	s.mu.RUnlock()

	return append(local, s.bridgeDescriptors(bridge)...)
}

// GetProviders returns all currently connected providers.
func (s *Service) GetProviders() []*ConnectedProvider {
	s.mu.RLock()
	defer s.mu.RUnlock()
	providers := make([]*ConnectedProvider, 0, len(s.providers))
	for _, provider := range s.providers {
		if provider.Status == StatusConnected {
			providers = append(providers, provider)
		}
	}
	return providers
}

// GetProvider returns a connected provider by ID.
func (s *Service) GetProvider(id string) *ConnectedProvider {
	s.mu.Lock()
	defer s.mu.Unlock()
	provider, ok := s.providers[id]
	if !ok || provider.Status != StatusConnected {
		return nil
	}
	s.lastAccessed[id] = time.Now()
	return provider
}

// EnsureConnected returns a connected provider by ID or name, connecting it if needed.
func (s *Service) EnsureConnected(ctx context.Context, idOrName string) (*ConnectedProvider, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	if provider := s.findConnectedProvider(idOrName); provider != nil {
		return provider, nil
	}

	desc := s.findDescriptor(idOrName)
	if desc == nil {
		return nil, nil
	}

	return s.connectProvider(ctx, *desc)
}

// Disconnect explicitly disconnects a provider by ID or fuzzy name.
func (s *Service) Disconnect(idOrName string) bool {
	provider := s.findAnyProvider(idOrName)
	if provider == nil {
		return false
	}

	s.markIntentionalDisconnect(provider.ID)
	provider.Consumer.Disconnect()
	s.forgetProvider(provider.ID)
	s.fireStateChange()
	return true
}

func (s *Service) initBridge() {
	s.mu.RLock()
	ctx := s.ctx
	config := s.config
	s.mu.RUnlock()
	if ctx == nil {
		return
	}

	client := NewBridgeClient(config.bridgeURL, config.logger)
	client.reconnectDelay = config.bridgeRetryDelay

	dialCtx, cancel := context.WithTimeout(ctx, config.bridgeDialTimeout)
	err := client.ConnectOnce(dialCtx)
	cancel()
	if err == nil {
		client.Start(ctx)
		s.attachBridge(client)
		config.logger.infof("[slop-bridge] Connected as client to existing bridge")
		return
	}

	if !config.hostBridge {
		config.logger.infof("[slop-bridge] No bridge found, retrying as client")
		client.Start(ctx)
		s.attachBridge(client)
		return
	}

	server := NewBridgeServer(config.bridgeAddr, config.bridgePath, config.logger)
	if err := server.Start(ctx); err == nil {
		s.attachBridge(server)
		return
	}

	config.logger.infof("[slop-bridge] Port taken, retrying as client")
	client = NewBridgeClient(config.bridgeURL, config.logger)
	client.reconnectDelay = config.bridgeRetryDelay
	client.Start(ctx)
	s.attachBridge(client)
}

func (s *Service) attachBridge(bridge Bridge) {
	bridge.OnProviderChange(func() {
		s.scan()
	})

	s.mu.Lock()
	if !s.started {
		s.mu.Unlock()
		bridge.Stop()
		return
	}
	s.bridge = bridge
	s.mu.Unlock()

	s.scan()
}

func (s *Service) scanTickerLoop() {
	ticker := time.NewTicker(s.config.scanInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.scan()
		case <-s.done():
			return
		}
	}
}

func (s *Service) idleTickerLoop() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.checkIdle()
		case <-s.done():
			return
		}
	}
}

func (s *Service) watchLoop(watcher *fsnotify.Watcher) {
	for {
		select {
		case <-s.done():
			return
		case _, ok := <-watcher.Events:
			if !ok {
				return
			}
			s.scheduleScan()
		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			s.config.logger.errorf("[slop] Discovery watcher error: %v", err)
		}
	}
}

func (s *Service) scheduleScan() {
	s.mu.Lock()
	if s.watchDebounce != nil {
		s.watchDebounce.Stop()
	}
	s.watchDebounce = time.AfterFunc(s.config.watchDebounce, s.scan)
	s.mu.Unlock()
}

func (s *Service) scan() {
	s.scanMu.Lock()
	defer s.scanMu.Unlock()

	local := s.readDescriptors()
	s.syncWatches()

	s.mu.Lock()
	s.localDescriptors = local
	bridge := s.bridge
	ctx := s.ctx
	autoConnect := s.config.autoConnect
	providers := make([]*ConnectedProvider, 0, len(s.providers))
	for _, provider := range s.providers {
		providers = append(providers, provider)
	}
	s.mu.Unlock()

	allDescriptors := append([]ProviderDescriptor{}, local...)
	allDescriptors = append(allDescriptors, s.bridgeDescriptors(bridge)...)

	allIDs := map[string]struct{}{}
	for _, desc := range allDescriptors {
		allIDs[desc.ID] = struct{}{}
	}

	for _, provider := range providers {
		if _, ok := allIDs[provider.ID]; ok {
			continue
		}
		s.markIntentionalDisconnect(provider.ID)
		provider.Consumer.Disconnect()
		s.forgetProvider(provider.ID)
	}

	if !autoConnect || ctx == nil {
		return
	}

	for _, desc := range allDescriptors {
		if s.hasProvider(desc.ID) {
			continue
		}
		go func(desc ProviderDescriptor) {
			_, _ = s.connectProvider(ctx, desc)
		}(desc)
	}
}

func (s *Service) checkIdle() {
	now := time.Now()
	var toDisconnect []*ConnectedProvider

	s.mu.RLock()
	for id, accessed := range s.lastAccessed {
		if now.Sub(accessed) <= s.config.idleTimeout {
			continue
		}
		if provider, ok := s.providers[id]; ok {
			toDisconnect = append(toDisconnect, provider)
		}
	}
	s.mu.RUnlock()

	for _, provider := range toDisconnect {
		s.config.logger.infof("[slop] Idle timeout: disconnecting %s", provider.Name)
		s.markIntentionalDisconnect(provider.ID)
		provider.Consumer.Disconnect()
		s.forgetProvider(provider.ID)
		s.fireStateChange()
	}
}

func (s *Service) connectProvider(ctx context.Context, desc ProviderDescriptor) (*ConnectedProvider, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	for {
		s.mu.Lock()
		existing := s.providers[desc.ID]
		if existing != nil {
			switch existing.Status {
			case StatusConnected:
				s.lastAccessed[desc.ID] = time.Now()
				s.mu.Unlock()
				return existing, nil
			case StatusConnecting:
				s.mu.Unlock()
				select {
				case <-ctx.Done():
					return nil, ctx.Err()
				case <-time.After(10 * time.Millisecond):
				}
				continue
			}
		}

		transport := s.createTransport(desc)
		if transport == nil {
			s.mu.Unlock()
			s.config.logger.infof("[slop] Skipping %s: unsupported transport %s", desc.Name, desc.Transport.Type)
			return nil, nil
		}

		provider := &ConnectedProvider{
			ID:         desc.ID,
			Name:       desc.Name,
			Descriptor: desc,
			Consumer:   slop.NewConsumer(transport),
			Status:     StatusConnecting,
		}
		s.providers[desc.ID] = provider
		s.mu.Unlock()

		connectCtx, cancel := context.WithTimeout(ctx, s.config.connectTimeout)
		hello, err := provider.Consumer.Connect(connectCtx)
		if err == nil {
			provider.Consumer.OnPatch(func(_ string, _ []slop.PatchOp, _ int) {
				s.fireStateChange()
			})
			provider.Consumer.OnDisconnect(func() {
				s.handleProviderDisconnect(desc, provider.Name)
			})
			provider.Consumer.OnError(func(code, message string) {
				s.config.logger.errorf("[slop] Provider %s error [%s]: %s", desc.ID, code, message)
			})
			provider.Consumer.OnEvent(func(name string, data any) {
				s.config.logger.infof("[slop] Provider %s event %s: %v", desc.ID, name, data)
			})

			var tree slop.WireNode
			provider.SubscriptionID, tree, err = provider.Consumer.Subscribe(connectCtx, "/", -1)
			_ = tree
			if err == nil {
				provider.Status = StatusConnected
				provider.Name = providerName(hello, desc.Name)
				provider.Descriptor.Name = desc.Name
				cancel()

				s.mu.Lock()
				s.lastAccessed[desc.ID] = time.Now()
				delete(s.reconnectAttempts, desc.ID)
				delete(s.suppressReconnect, desc.ID)
				s.mu.Unlock()

				s.config.logger.infof("[slop] Connected to %s (%s) via %s", provider.Name, desc.ID, desc.Transport.Type)
				s.fireStateChange()
				return provider, nil
			}
		}
		cancel()

		s.config.logger.errorf("[slop] Failed to connect to %s: %v", desc.Name, err)
		s.forgetProvider(desc.ID)
		return nil, err
	}
}

func (s *Service) handleProviderDisconnect(desc ProviderDescriptor, name string) {
	s.forgetProvider(desc.ID)
	s.fireStateChange()

	if s.consumeIntentionalDisconnect(desc.ID) {
		return
	}
	if !s.descriptorExists(desc.ID) {
		return
	}

	attempt := s.incrementReconnectAttempt(desc.ID)
	delay := s.config.reconnectBaseDelay << (attempt - 1)
	if delay > s.config.maxReconnectDelay {
		delay = s.config.maxReconnectDelay
	}

	s.config.logger.infof("[slop] Will reconnect to %s in %s (attempt %d)", name, delay, attempt)
	time.AfterFunc(delay, func() {
		if s.doneErr() != nil || s.hasProvider(desc.ID) {
			return
		}
		ctx := s.context()
		if ctx == nil {
			return
		}
		_, _ = s.connectProvider(ctx, desc)
	})
}

func (s *Service) createTransport(desc ProviderDescriptor) slop.ClientTransport {
	switch desc.Transport.Type {
	case "unix":
		if desc.Transport.Path != "" {
			return &slop.UnixClientTransport{Path: desc.Transport.Path}
		}
	case "ws":
		if desc.Transport.URL != "" {
			return &slop.WSClientTransport{URL: desc.Transport.URL}
		}
	case "relay":
		if desc.ProviderKey != "" && s.bridge != nil {
			return &BridgeRelayTransport{Bridge: s.bridge, ProviderKey: desc.ProviderKey}
		}
	}
	return nil
}

func (s *Service) readDescriptors() []ProviderDescriptor {
	var descriptors []ProviderDescriptor
	for _, dir := range s.config.providersDirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
				continue
			}
			path := filepath.Join(dir, entry.Name())
			content, err := os.ReadFile(path)
			if err != nil {
				s.config.logger.errorf("[slop] Failed to read %s: %v", path, err)
				continue
			}

			var desc ProviderDescriptor
			if err := json.Unmarshal(content, &desc); err != nil {
				s.config.logger.errorf("[slop] Failed to parse %s: %v", path, err)
				continue
			}
			if !isValidDescriptor(desc) {
				s.config.logger.errorf("[slop] Invalid descriptor in %s", path)
				continue
			}

			desc.Source = SourceLocal
			descriptors = append(descriptors, desc)
		}
	}
	return descriptors
}

func (s *Service) syncWatches() {
	s.mu.RLock()
	watcher := s.watcher
	s.mu.RUnlock()
	if watcher == nil {
		return
	}

	for _, dir := range s.config.providersDirs {
		if _, err := os.Stat(dir); err != nil {
			continue
		}

		s.mu.RLock()
		_, watched := s.watchedDirs[dir]
		s.mu.RUnlock()
		if watched {
			continue
		}

		if err := watcher.Add(dir); err != nil {
			s.config.logger.errorf("[slop] Failed to watch %s: %v", dir, err)
			continue
		}

		s.mu.Lock()
		s.watchedDirs[dir] = struct{}{}
		s.mu.Unlock()
	}
}

func (s *Service) bridgeDescriptors(bridge Bridge) []ProviderDescriptor {
	if bridge == nil || !bridge.Running() {
		return nil
	}
	providers := bridge.Providers()
	descriptors := make([]ProviderDescriptor, 0, len(providers))
	for _, provider := range providers {
		descriptors = append(descriptors, bridgeProviderToDescriptor(provider))
	}
	return descriptors
}

func (s *Service) findConnectedProvider(idOrName string) *ConnectedProvider {
	needle := strings.ToLower(idOrName)

	s.mu.Lock()
	defer s.mu.Unlock()
	if provider, ok := s.providers[idOrName]; ok && provider.Status == StatusConnected {
		s.lastAccessed[provider.ID] = time.Now()
		return provider
	}
	for _, provider := range s.providers {
		if provider.Status == StatusConnected && strings.Contains(strings.ToLower(provider.Name), needle) {
			s.lastAccessed[provider.ID] = time.Now()
			return provider
		}
	}
	return nil
}

func (s *Service) findAnyProvider(idOrName string) *ConnectedProvider {
	needle := strings.ToLower(idOrName)
	s.mu.RLock()
	defer s.mu.RUnlock()
	if provider, ok := s.providers[idOrName]; ok {
		return provider
	}
	for _, provider := range s.providers {
		if strings.Contains(strings.ToLower(provider.Name), needle) {
			return provider
		}
	}
	return nil
}

func (s *Service) findDescriptor(idOrName string) *ProviderDescriptor {
	needle := strings.ToLower(idOrName)
	for _, desc := range s.GetDiscovered() {
		if desc.ID == idOrName || strings.Contains(strings.ToLower(desc.Name), needle) {
			copy := desc
			return &copy
		}
	}
	return nil
}

func (s *Service) hasProvider(id string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.providers[id]
	return ok
}

func (s *Service) forgetProvider(id string) {
	s.mu.Lock()
	delete(s.providers, id)
	delete(s.lastAccessed, id)
	delete(s.reconnectAttempts, id)
	s.mu.Unlock()
}

func (s *Service) markIntentionalDisconnect(id string) {
	s.mu.Lock()
	s.suppressReconnect[id] = true
	s.mu.Unlock()
}

func (s *Service) consumeIntentionalDisconnect(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	marked := s.suppressReconnect[id]
	delete(s.suppressReconnect, id)
	return marked
}

func (s *Service) incrementReconnectAttempt(id string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reconnectAttempts[id]++
	return s.reconnectAttempts[id]
}

func (s *Service) descriptorExists(id string) bool {
	for _, desc := range s.GetDiscovered() {
		if desc.ID == id {
			return true
		}
	}
	return false
}

func (s *Service) context() context.Context {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.ctx
}

func (s *Service) done() <-chan struct{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.ctx == nil {
		return nil
	}
	return s.ctx.Done()
}

func (s *Service) doneErr() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.ctx == nil {
		return context.Canceled
	}
	return s.ctx.Err()
}

func (s *Service) fireStateChange() {
	s.mu.RLock()
	callback := s.stateChange
	s.mu.RUnlock()
	if callback != nil {
		callback()
	}
}

func isValidDescriptor(desc ProviderDescriptor) bool {
	if desc.ID == "" || desc.Name == "" {
		return false
	}
	if _, ok := validTransportTypes[desc.Transport.Type]; !ok {
		return false
	}
	if desc.Capabilities == nil {
		return false
	}
	return true
}

func providerName(hello map[string]any, fallback string) string {
	provider, _ := hello["provider"].(map[string]any)
	name, _ := provider["name"].(string)
	if name == "" {
		return fallback
	}
	return name
}
