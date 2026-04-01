package tui

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/slop-ai/slop-cli/provider"
)

type DiscoveryModel struct {
	providers    []provider.Descriptor
	cursor       int
	width        int
	height       int
	manualInput  textinput.Model
	manualMode   bool
	err          error
}

type ProvidersRefreshedMsg struct {
	Providers []provider.Descriptor
	Err       error
}

type ConnectRequestMsg struct {
	Address string
}

func NewDiscoveryModel() DiscoveryModel {
	ti := textinput.New()
	ti.Placeholder = "ws://localhost:3000/slop or /tmp/slop/app.sock"
	ti.CharLimit = 256
	ti.Width = 60

	return DiscoveryModel{
		manualInput: ti,
	}
}

func (m DiscoveryModel) Init() tea.Cmd {
	return refreshProviders
}

func refreshProviders() tea.Msg {
	providers, err := provider.Discover()
	return ProvidersRefreshedMsg{Providers: providers, Err: err}
}

func (m DiscoveryModel) Update(msg tea.Msg) (DiscoveryModel, tea.Cmd) {
	switch msg := msg.(type) {
	case ProvidersRefreshedMsg:
		m.providers = msg.Providers
		m.err = msg.Err
		if m.cursor >= len(m.providers) {
			m.cursor = max(len(m.providers)-1, 0)
		}
		return m, tea.Tick(2*time.Second, func(time.Time) tea.Msg {
			return refreshProviders()
		})

	case tea.KeyMsg:
		if m.manualMode {
			return m.updateManualMode(msg)
		}
		return m.updateListMode(msg)
	}

	return m, nil
}

func (m DiscoveryModel) updateListMode(msg tea.KeyMsg) (DiscoveryModel, tea.Cmd) {
	switch {
	case key.Matches(msg, Keys.Up):
		if m.cursor > 0 {
			m.cursor--
		}
	case key.Matches(msg, Keys.Down):
		if m.cursor < len(m.providers)-1 {
			m.cursor++
		}
	case key.Matches(msg, Keys.Enter):
		if len(m.providers) > 0 {
			desc := m.providers[m.cursor]
			return m, func() tea.Msg {
				return ConnectRequestMsg{Address: desc.Address()}
			}
		}
	case key.Matches(msg, Keys.Manual):
		m.manualMode = true
		m.manualInput.Focus()
		return m, textinput.Blink
	}
	return m, nil
}

func (m DiscoveryModel) updateManualMode(msg tea.KeyMsg) (DiscoveryModel, tea.Cmd) {
	switch {
	case key.Matches(msg, Keys.Escape):
		m.manualMode = false
		m.manualInput.Blur()
		m.manualInput.Reset()
		return m, nil
	case key.Matches(msg, Keys.Enter):
		addr := strings.TrimSpace(m.manualInput.Value())
		if addr != "" {
			m.manualMode = false
			m.manualInput.Blur()
			return m, func() tea.Msg {
				return ConnectRequestMsg{Address: addr}
			}
		}
		return m, nil
	}

	var cmd tea.Cmd
	m.manualInput, cmd = m.manualInput.Update(msg)
	return m, cmd
}

func (m DiscoveryModel) View() string {
	var b strings.Builder

	// Title
	title := StyleTitle.Render("SLOP Inspector")
	b.WriteString("\n  " + title + "\n")

	// Separator
	sep := StyleSeparator.Render(strings.Repeat("─", max(min(m.width-4, 60), 0)))
	b.WriteString("  " + sep + "\n\n")

	if m.manualMode {
		b.WriteString("  " + StyleSubtitle.Render("Enter address:") + "\n\n")
		b.WriteString("  " + m.manualInput.View() + "\n\n")
		b.WriteString("  " + helpLine("enter", "connect", "esc", "cancel") + "\n")
		return b.String()
	}

	// Provider list
	if len(m.providers) == 0 {
		b.WriteString("  " + lipgloss.NewStyle().Foreground(ColorTextMuted).Render("No local providers found") + "\n\n")
	} else {
		b.WriteString("  " + StyleSubtitle.Render("Local Providers:") + "\n\n")
		for i, p := range m.providers {
			cursor := "  "
			nameStyle := lipgloss.NewStyle().Foreground(ColorTextPrimary)
			addrStyle := lipgloss.NewStyle().Foreground(ColorTextMuted)

			if i == m.cursor {
				cursor = StylePrimary().Render("> ")
				nameStyle = nameStyle.Bold(true)
			}

			dot := lipgloss.NewStyle().Foreground(ColorPrimary).Render("●")
			name := nameStyle.Render(p.Name)
			if p.Name == "" {
				name = nameStyle.Render(p.ID)
			}
			addr := addrStyle.Render(p.Address())
			desc := ""
			if p.Description != "" {
				desc = lipgloss.NewStyle().Foreground(ColorTextSecondary).Render(" — " + p.Description)
			}

			b.WriteString(fmt.Sprintf("  %s%s %s %s%s\n", cursor, dot, name, addr, desc))
		}
		b.WriteString("\n")
	}

	if m.err != nil {
		b.WriteString("  " + StyleLogError.Render(m.err.Error()) + "\n\n")
	}

	// Help
	b.WriteString("  " + helpLine("enter", "connect", "m", "manual address", "q", "quit") + "\n")

	return b.String()
}

func StylePrimary() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(ColorPrimary)
}

func helpLine(pairs ...string) string {
	var parts []string
	for i := 0; i < len(pairs)-1; i += 2 {
		k := StyleHelpKey.Render("[" + pairs[i] + "]")
		d := StyleHelpDesc.Render(" " + pairs[i+1])
		parts = append(parts, k+d)
	}
	return strings.Join(parts, "  ")
}
