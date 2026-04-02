package provider

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	slop "github.com/devteapot/slop/packages/go/slop-ai"
)

type LogEntry struct {
	Time    time.Time
	Kind    string // "snapshot", "patch", "error", "event", "invoke", "result"
	Message string
}

type Manager struct {
	consumer   *slop.Consumer
	subID      string
	tree       *slop.WireNode
	address    string
	mu         sync.RWMutex
	pendingLog []LogEntry
}

func NewManager() *Manager {
	return &Manager{}
}

func (m *Manager) Connect(ctx context.Context, address string) error {
	m.address = address
	transport := m.transportForAddress(address)
	if transport == nil {
		return fmt.Errorf("unsupported address: %s", address)
	}

	consumer := slop.NewConsumer(transport)

	hello, err := consumer.Connect(ctx)
	if err != nil {
		return fmt.Errorf("connect failed: %w", err)
	}

	m.consumer = consumer

	// Log hello
	providerInfo := ""
	if p, ok := hello["provider"].(map[string]any); ok {
		if name, ok := p["name"].(string); ok {
			providerInfo = name
		}
	}
	m.log("snapshot", fmt.Sprintf("Connected to %s", providerInfo))

	// Register callbacks
	consumer.OnPatch(func(subID string, ops []slop.PatchOp, version int) {
		tree := consumer.Tree(subID)
		if tree != nil {
			m.mu.Lock()
			m.tree = tree
			m.mu.Unlock()
		}
	})

	consumer.OnError(func(code, message string) {
		m.log("error", fmt.Sprintf("[%s] %s", code, message))
	})

	consumer.OnEvent(func(name string, data any) {
		m.log("event", fmt.Sprintf("%s: %v", name, data))
	})

	consumer.OnDisconnect(func() {
		m.log("error", "Disconnected")
	})

	// Subscribe to full tree
	subID, tree, err := consumer.Subscribe(ctx, "/", -1)
	if err != nil {
		consumer.Disconnect()
		return fmt.Errorf("subscribe failed: %w", err)
	}

	m.mu.Lock()
	m.subID = subID
	m.tree = &tree
	m.mu.Unlock()

	nodeCount := countNodes(tree)
	m.log("snapshot", fmt.Sprintf("Received tree (%d nodes)", nodeCount))

	return nil
}

func (m *Manager) Disconnect() {
	if m.consumer != nil {
		m.consumer.Disconnect()
		m.consumer = nil
	}
}

func (m *Manager) Tree() *slop.WireNode {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.tree
}

func (m *Manager) Address() string {
	return m.address
}

func (m *Manager) Invoke(ctx context.Context, path, action string, params slop.Params) (map[string]any, error) {
	if m.consumer == nil {
		return nil, fmt.Errorf("not connected")
	}

	return m.consumer.Invoke(ctx, path, action, params)
}

func (m *Manager) DrainLog() []LogEntry {
	m.mu.Lock()
	defer m.mu.Unlock()
	entries := m.pendingLog
	m.pendingLog = nil
	return entries
}

func (m *Manager) log(kind, message string) {
	entry := LogEntry{
		Time:    time.Now(),
		Kind:    kind,
		Message: message,
	}
	m.mu.Lock()
	m.pendingLog = append(m.pendingLog, entry)
	m.mu.Unlock()
}

func (m *Manager) transportForAddress(address string) slop.ClientTransport {
	if strings.HasPrefix(address, "ws://") || strings.HasPrefix(address, "wss://") {
		return &slop.WSClientTransport{URL: address}
	}
	if strings.HasPrefix(address, "unix:") {
		return &slop.UnixClientTransport{Path: strings.TrimPrefix(address, "unix:")}
	}
	// Assume unix socket path if it looks like a file path
	if strings.HasPrefix(address, "/") || strings.HasPrefix(address, ".") {
		return &slop.UnixClientTransport{Path: address}
	}
	return nil
}

func countNodes(node slop.WireNode) int {
	count := 1
	for _, child := range node.Children {
		count += countNodes(child)
	}
	return count
}
