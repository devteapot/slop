package tui

import (
	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/slop-ai/slop-cli/bridge"
)

type view int

const (
	viewDiscovery view = iota
	viewInspector
)

type App struct {
	view     view
	discovery DiscoveryModel
	inspector InspectorModel
	width    int
	height   int
	quitting bool
	bridge   bridge.Bridge
}

func NewApp(connectAddr string, b bridge.Bridge) App {
	app := App{
		view:      viewDiscovery,
		discovery: NewDiscoveryModel(b),
		inspector: NewInspectorModel(),
		bridge:    b,
	}

	if connectAddr != "" {
		app.view = viewDiscovery // will auto-connect via Init
	}

	return app
}

func (a App) Init() tea.Cmd {
	return tea.Batch(
		a.discovery.Init(),
		tea.WindowSize(),
	)
}

func (a App) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		a.width = msg.Width
		a.height = msg.Height
		a.discovery.width = msg.Width
		a.discovery.height = msg.Height
		a.inspector.width = msg.Width
		a.inspector.height = msg.Height
		a.inspector = a.inspector.Resize()
		return a, nil

	case tea.KeyMsg:
		// Global quit only from discovery view (inspector handles its own quit)
		if key.Matches(msg, Keys.Quit) && a.view == viewDiscovery {
			if a.bridge != nil {
				a.bridge.Close()
			}
			a.quitting = true
			return a, tea.Quit
		}

	case ConnectRequestMsg:
		a.view = viewInspector
		a.inspector.width = a.width
		a.inspector.height = a.height
		a.inspector = a.inspector.Resize()
		if msg.BridgeRelay && a.bridge != nil {
			transport := &bridge.RelayTransport{
				Bridge:      a.bridge,
				ProviderKey: msg.ProviderKey,
			}
			return a, a.inspector.ConnectWithTransport(msg.Address, transport)
		}
		return a, a.inspector.Connect(msg.Address)

	case DisconnectedMsg:
		a.view = viewDiscovery
		return a, a.discovery.refreshProviders()
	}

	switch a.view {
	case viewDiscovery:
		var cmd tea.Cmd
		a.discovery, cmd = a.discovery.Update(msg)
		return a, cmd
	case viewInspector:
		var cmd tea.Cmd
		a.inspector, cmd = a.inspector.Update(msg)
		return a, cmd
	}

	return a, nil
}

func (a App) View() string {
	if a.quitting {
		return ""
	}

	switch a.view {
	case viewDiscovery:
		return a.discovery.View()
	case viewInspector:
		return a.inspector.View()
	}

	return ""
}
