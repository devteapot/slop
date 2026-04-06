package discovery

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	slop "github.com/devteapot/slop/packages/go/slop-ai"
)

const (
	DefaultBridgeAddr = "127.0.0.1:9339"
	DefaultBridgePath = "/slop-bridge"
	DefaultBridgeURL  = "ws://127.0.0.1:9339/slop-bridge"
)

const (
	defaultIdleTimeout         = 5 * time.Minute
	defaultConnectTimeout      = 10 * time.Second
	defaultScanInterval        = 15 * time.Second
	defaultWatchDebounce       = 500 * time.Millisecond
	defaultReconnectBaseDelay  = 3 * time.Second
	defaultMaxReconnectDelay   = 30 * time.Second
	defaultBridgeDialTimeout   = 1 * time.Second
	defaultBridgeReconnectWait = 5 * time.Second
)

// Logger is an optional structured logger used by the discovery layer.
type Logger struct {
	Infof  func(format string, args ...any)
	Errorf func(format string, args ...any)
}

func (l Logger) infof(format string, args ...any) {
	if l.Infof != nil {
		l.Infof(format, args...)
	}
}

func (l Logger) errorf(format string, args ...any) {
	if l.Errorf != nil {
		l.Errorf(format, args...)
	}
}

// ProviderSource identifies where a provider descriptor came from.
type ProviderSource string

const (
	SourceLocal  ProviderSource = "local"
	SourceBridge ProviderSource = "bridge"
)

// ProviderStatus describes a provider connection state.
type ProviderStatus string

const (
	StatusConnecting   ProviderStatus = "connecting"
	StatusConnected    ProviderStatus = "connected"
	StatusDisconnected ProviderStatus = "disconnected"
)

// TransportDescriptor describes how to connect to a provider.
type TransportDescriptor struct {
	Type string `json:"type"`
	Path string `json:"path,omitempty"`
	URL  string `json:"url,omitempty"`
}

// ProviderDescriptor describes a discoverable SLOP provider.
type ProviderDescriptor struct {
	ID           string              `json:"id"`
	Name         string              `json:"name"`
	SlopVersion  string              `json:"slop_version"`
	Transport    TransportDescriptor `json:"transport"`
	PID          int                 `json:"pid,omitempty"`
	Capabilities []string            `json:"capabilities"`
	ProviderKey  string              `json:"-"`
	Source       ProviderSource      `json:"-"`
}

// Address returns a display-friendly address for a provider descriptor.
func (d ProviderDescriptor) Address() string {
	switch d.Transport.Type {
	case "unix":
		return "unix:" + d.Transport.Path
	case "ws":
		return d.Transport.URL
	case "relay":
		if d.ProviderKey != "" {
			return "bridge:" + d.ProviderKey
		}
	}
	return d.Transport.Type
}

// ConnectedProvider is an active provider connection managed by the service.
type ConnectedProvider struct {
	ID             string
	Name           string
	Descriptor     ProviderDescriptor
	Consumer       *slop.Consumer
	SubscriptionID string
	Status         ProviderStatus
}

// ServiceOptions configures the discovery service.
type ServiceOptions struct {
	Logger             Logger
	AutoConnect        bool
	HostBridge         *bool
	ProvidersDirs      []string
	BridgeURL          string
	BridgeAddr         string
	BridgePath         string
	IdleTimeout        time.Duration
	ConnectTimeout     time.Duration
	ScanInterval       time.Duration
	WatchDebounce      time.Duration
	ReconnectBaseDelay time.Duration
	MaxReconnectDelay  time.Duration
	BridgeDialTimeout  time.Duration
	BridgeRetryDelay   time.Duration
}

type serviceConfig struct {
	logger             Logger
	autoConnect        bool
	hostBridge         bool
	providersDirs      []string
	bridgeURL          string
	bridgeAddr         string
	bridgePath         string
	idleTimeout        time.Duration
	connectTimeout     time.Duration
	scanInterval       time.Duration
	watchDebounce      time.Duration
	reconnectBaseDelay time.Duration
	maxReconnectDelay  time.Duration
	bridgeDialTimeout  time.Duration
	bridgeRetryDelay   time.Duration
}

func normalizeOptions(opts ServiceOptions) serviceConfig {
	bridgeURL, bridgeAddr, bridgePath := normalizeBridgeLocation(opts)

	providersDirs := opts.ProvidersDirs
	if len(providersDirs) == 0 {
		providersDirs = defaultProvidersDirs()
	}

	return serviceConfig{
		logger:             opts.Logger,
		autoConnect:        opts.AutoConnect,
		hostBridge:         boolOrDefault(opts.HostBridge, true),
		providersDirs:      providersDirs,
		bridgeURL:          bridgeURL,
		bridgeAddr:         bridgeAddr,
		bridgePath:         bridgePath,
		idleTimeout:        durationOr(opts.IdleTimeout, defaultIdleTimeout),
		connectTimeout:     durationOr(opts.ConnectTimeout, defaultConnectTimeout),
		scanInterval:       durationOr(opts.ScanInterval, defaultScanInterval),
		watchDebounce:      durationOr(opts.WatchDebounce, defaultWatchDebounce),
		reconnectBaseDelay: durationOr(opts.ReconnectBaseDelay, defaultReconnectBaseDelay),
		maxReconnectDelay:  durationOr(opts.MaxReconnectDelay, defaultMaxReconnectDelay),
		bridgeDialTimeout:  durationOr(opts.BridgeDialTimeout, defaultBridgeDialTimeout),
		bridgeRetryDelay:   durationOr(opts.BridgeRetryDelay, defaultBridgeReconnectWait),
	}
}

func durationOr(value, fallback time.Duration) time.Duration {
	if value > 0 {
		return value
	}
	return fallback
}

func defaultProvidersDirs() []string {
	home := homeDir()
	return []string{
		filepath.Join(home, ".slop", "providers"),
		filepath.Join(os.TempDir(), "slop", "providers"),
	}
}

func homeDir() string {
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return home
	}
	if home := os.Getenv("HOME"); home != "" {
		return home
	}
	return os.TempDir()
}

func normalizeBridgeLocation(opts ServiceOptions) (bridgeURL, bridgeAddr, bridgePath string) {
	bridgeURL = opts.BridgeURL
	bridgeAddr = opts.BridgeAddr
	bridgePath = opts.BridgePath

	if bridgeURL == "" && bridgeAddr == "" && bridgePath == "" {
		return DefaultBridgeURL, DefaultBridgeAddr, DefaultBridgePath
	}

	if bridgeURL != "" {
		if parsed, err := url.Parse(bridgeURL); err == nil {
			if bridgeAddr == "" {
				bridgeAddr = parsed.Host
			}
			if bridgePath == "" {
				bridgePath = parsed.Path
			}
		}
	}

	if bridgeAddr == "" {
		bridgeAddr = DefaultBridgeAddr
	}
	if bridgePath == "" {
		bridgePath = DefaultBridgePath
	}
	if bridgeURL == "" {
		bridgeURL = fmt.Sprintf("ws://%s%s", bridgeAddr, bridgePath)
	}

	return bridgeURL, bridgeAddr, bridgePath
}

func boolOrDefault(value *bool, fallback bool) bool {
	if value != nil {
		return *value
	}
	return fallback
}
