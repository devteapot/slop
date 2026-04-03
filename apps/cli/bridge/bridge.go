package bridge

// Bridge is the common interface for both the bridge Server (when CLI owns the port)
// and the bridge Client (when CLI connects to an existing bridge like the Desktop app).
type Bridge interface {
	Running() bool
	Providers() []BridgeProvider
	OnProviderChange(fn func())
	SubscribeRelay(providerKey string) chan map[string]any
	UnsubscribeRelay(providerKey string, ch chan map[string]any)
	Send(msg map[string]any) error
	Close()
}
