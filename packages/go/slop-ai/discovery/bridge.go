package discovery

// BridgeProvider represents a provider announced through the extension bridge.
type BridgeProvider struct {
	ProviderKey string
	TabID       int
	ID          string
	Name        string
	Transport   string
	URL         string
}

// Bridge is the common interface shared by the bridge client and server.
type Bridge interface {
	Running() bool
	Providers() []BridgeProvider
	OnProviderChange(fn func())
	SubscribeRelay(providerKey string) chan map[string]any
	UnsubscribeRelay(providerKey string, ch chan map[string]any)
	Send(msg map[string]any) error
	Stop()
}

func parseBridgeProvider(msg map[string]any) (BridgeProvider, bool) {
	providerKey, _ := msg["providerKey"].(string)
	if providerKey == "" {
		return BridgeProvider{}, false
	}

	tabID := 0
	switch value := msg["tabId"].(type) {
	case float64:
		tabID = int(value)
	case int:
		tabID = value
	case int64:
		tabID = int(value)
	}

	provider, _ := msg["provider"].(map[string]any)
	transport, _ := provider["transport"].(string)
	if transport == "" {
		transport = "postmessage"
	}

	id, _ := provider["id"].(string)
	if id == "" {
		id = providerKey
	}
	name, _ := provider["name"].(string)
	if name == "" {
		name = "Tab"
	}
	url, _ := provider["url"].(string)

	return BridgeProvider{
		ProviderKey: providerKey,
		TabID:       tabID,
		ID:          id,
		Name:        name,
		Transport:   transport,
		URL:         url,
	}, true
}

func bridgeProviderToDescriptor(provider BridgeProvider) ProviderDescriptor {
	transport := TransportDescriptor{Type: "relay"}
	if provider.Transport == "ws" && provider.URL != "" {
		transport = TransportDescriptor{Type: "ws", URL: provider.URL}
	}

	return ProviderDescriptor{
		ID:           provider.ProviderKey,
		Name:         provider.Name,
		SlopVersion:  "1.0",
		Transport:    transport,
		Capabilities: []string{},
		ProviderKey:  provider.ProviderKey,
		Source:       SourceBridge,
	}
}
