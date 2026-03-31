package tui

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/slop-ai/slop-cli/provider"
	slop "github.com/slop-ai/slop-go"
)

type pane int

const (
	paneTree pane = iota
	paneLog
)

type InspectorModel struct {
	manager *provider.Manager
	tree    viewport.Model
	log     viewport.Model
	active  pane
	width   int
	height  int
	address string

	// Tree state
	flatNodes []FlatNode
	cursor    int

	// Log state
	logEntries []provider.LogEntry

	// Invoke overlay
	invoking    bool
	invokeModel InvokeModel

	// Async update channel
	updateCh chan tea.Msg
}

type TreeUpdatedMsg struct{}
type LogEntryMsg struct{ Entry provider.LogEntry }
type ConnectedMsg struct{ Err error }
type DisconnectedMsg struct{}
type InvokeResultMsg struct {
	Result map[string]any
	Err    error
}

func NewInspectorModel() InspectorModel {
	return InspectorModel{
		manager:  provider.NewManager(),
		tree:     viewport.New(80, 20),
		log:      viewport.New(80, 8),
		updateCh: make(chan tea.Msg, 64),
	}
}

func (m InspectorModel) Connect(address string) tea.Cmd {
	m.address = address

	// Set up callbacks before connecting — they write to the channel
	mgr := m.manager
	ch := m.updateCh

	mgr.OnTreeUpdate(func() {
		select {
		case ch <- TreeUpdatedMsg{}:
		default:
		}
	})

	mgr.OnLog(func(entry provider.LogEntry) {
		select {
		case ch <- LogEntryMsg{Entry: entry}:
		default:
		}
	})

	return func() tea.Msg {
		ctx := context.Background()
		err := mgr.Connect(ctx, address)
		return ConnectedMsg{Err: err}
	}
}

func (m InspectorModel) Resize() InspectorModel {
	if m.width == 0 || m.height == 0 {
		return m
	}

	// Layout: header(1) + treeLabel(1) + tree + sep(1) + logLabel(1) + log + sep(1) + help(1)
	contentHeight := m.height - 6
	treeHeight := contentHeight * 60 / 100
	logHeight := contentHeight - treeHeight

	if treeHeight < 3 {
		treeHeight = 3
	}
	if logHeight < 3 {
		logHeight = 3
	}

	m.tree.Width = m.width
	m.tree.Height = treeHeight
	m.log.Width = m.width
	m.log.Height = logHeight

	return m
}

// waitForUpdate returns a Cmd that blocks until the next async update arrives.
func (m InspectorModel) waitForUpdate() tea.Cmd {
	ch := m.updateCh
	return func() tea.Msg {
		return <-ch
	}
}

func (m InspectorModel) Update(msg tea.Msg) (InspectorModel, tea.Cmd) {
	switch msg := msg.(type) {
	case ConnectedMsg:
		if msg.Err != nil {
			m.addLog(provider.LogEntry{Kind: "error", Message: msg.Err.Error(), Time: time.Now()})
			return m, func() tea.Msg { return DisconnectedMsg{} }
		}
		m.address = m.manager.Address()
		m.refreshTree()
		return m, m.waitForUpdate()

	case TreeUpdatedMsg:
		m.refreshTree()
		return m, m.waitForUpdate()

	case LogEntryMsg:
		m.addLog(msg.Entry)
		return m, m.waitForUpdate()

	case InvokeResultMsg:
		m.invokeModel.SetResult(msg.Result, msg.Err)
		if msg.Err != nil {
			m.addLog(provider.LogEntry{Kind: "error", Message: msg.Err.Error(), Time: time.Now()})
		} else {
			status, _ := msg.Result["status"].(string)
			m.addLog(provider.LogEntry{Kind: "result", Message: fmt.Sprintf("status=%s", status), Time: time.Now()})
		}
		return m, m.waitForUpdate()

	case tea.KeyMsg:
		if m.invoking {
			return m.updateInvoke(msg)
		}
		return m.updateNormal(msg)
	}

	return m, nil
}

func (m InspectorModel) updateNormal(msg tea.KeyMsg) (InspectorModel, tea.Cmd) {
	switch {
	case key.Matches(msg, Keys.Quit):
		m.manager.Disconnect()
		return m, tea.Quit

	case key.Matches(msg, Keys.Back):
		m.manager.Disconnect()
		return m, func() tea.Msg { return DisconnectedMsg{} }

	case key.Matches(msg, Keys.Tab):
		if m.active == paneTree {
			m.active = paneLog
		} else {
			m.active = paneTree
		}
		return m, nil

	case key.Matches(msg, Keys.Up):
		if m.active == paneTree {
			if m.cursor > 0 {
				m.cursor--
				m.updateTreeContent()
				m.ensureCursorVisible()
			}
		} else {
			m.log, _ = m.log.Update(msg)
		}
		return m, nil

	case key.Matches(msg, Keys.Down):
		if m.active == paneTree {
			if m.cursor < len(m.flatNodes)-1 {
				m.cursor++
				m.updateTreeContent()
				m.ensureCursorVisible()
			}
		} else {
			m.log, _ = m.log.Update(msg)
		}
		return m, nil

	case key.Matches(msg, Keys.Enter):
		if m.active == paneTree && m.cursor < len(m.flatNodes) {
			fn := m.flatNodes[m.cursor]
			if len(fn.Node.Affordances) > 0 {
				m.invoking = true
				m.invokeModel = NewInvokeModel(fn.Path, fn.Node.Affordances)
				return m, nil
			}
		}
		return m, nil
	}

	return m, nil
}

func (m InspectorModel) updateInvoke(msg tea.KeyMsg) (InspectorModel, tea.Cmd) {
	if key.Matches(msg, Keys.Escape) {
		m.invoking = false
		return m, nil
	}

	var cmd tea.Cmd
	m.invokeModel, cmd = m.invokeModel.Update(msg)

	if m.invokeModel.submitted {
		m.invoking = false
		path := m.invokeModel.path
		action := m.invokeModel.SelectedAction()
		params := m.invokeModel.CollectParams()
		mgr := m.manager

		m.addLog(provider.LogEntry{Kind: "invoke", Message: fmt.Sprintf("%s → %s", path, action), Time: time.Now()})

		return m, func() tea.Msg {
			ctx := context.Background()
			result, err := mgr.Invoke(ctx, path, action, slop.Params(params))
			return InvokeResultMsg{Result: result, Err: err}
		}
	}

	return m, cmd
}

func (m *InspectorModel) refreshTree() {
	tree := m.manager.Tree()
	if tree == nil {
		return
	}
	m.flatNodes = FlattenTree(*tree, "", 0)
	if m.cursor >= len(m.flatNodes) {
		m.cursor = len(m.flatNodes) - 1
	}
	if m.cursor < 0 {
		m.cursor = 0
	}
	m.updateTreeContent()
}

func (m *InspectorModel) updateTreeContent() {
	content := RenderTree(m.flatNodes, m.cursor, m.width)
	m.tree.SetContent(content)
}

func (m *InspectorModel) ensureCursorVisible() {
	if m.cursor < m.tree.YOffset {
		m.tree.SetYOffset(m.cursor)
	} else if m.cursor >= m.tree.YOffset+m.tree.Height {
		m.tree.SetYOffset(m.cursor - m.tree.Height + 1)
	}
}

func (m *InspectorModel) addLog(entry provider.LogEntry) {
	if entry.Time.IsZero() {
		entry.Time = time.Now()
	}
	m.logEntries = append(m.logEntries, entry)

	if len(m.logEntries) > 500 {
		m.logEntries = m.logEntries[len(m.logEntries)-500:]
	}

	m.updateLogContent()
}

func (m *InspectorModel) updateLogContent() {
	var lines []string
	for _, entry := range m.logEntries {
		ts := StyleTimestamp.Render(entry.Time.Format("15:04:05"))
		var kindStyle lipgloss.Style
		switch entry.Kind {
		case "snapshot":
			kindStyle = StyleLogSnapshot
		case "patch":
			kindStyle = StyleLogPatch
		case "error":
			kindStyle = StyleLogError
		case "event":
			kindStyle = StyleLogEvent
		case "invoke":
			kindStyle = StyleAffordance
		case "result":
			kindStyle = StyleLogSnapshot
		default:
			kindStyle = StyleProperty
		}
		kind := kindStyle.Render(entry.Kind)
		msg := lipgloss.NewStyle().Foreground(ColorTextPrimary).Render(entry.Message)
		lines = append(lines, fmt.Sprintf("  %s %s %s", ts, kind, msg))
	}

	m.log.SetContent(strings.Join(lines, "\n"))
	m.log.GotoBottom()
}

func (m InspectorModel) View() string {
	if m.invoking {
		return m.invokeModel.View(m.width, m.height)
	}

	var b strings.Builder

	// Header
	tree := m.manager.Tree()
	affCount := CountAffordances(tree)
	nodeCount := len(m.flatNodes)

	addr := StyleSubtitle.Render(m.address)
	status := StyleLogSnapshot.Render("connected")
	stats := StyleProperty.Render(fmt.Sprintf("%d nodes  %d affordances", nodeCount, affCount))

	headerContent := fmt.Sprintf("  %s  %s  %s", addr, status, stats)
	header := StyleHeader.Width(m.width).Render(headerContent)
	b.WriteString(header + "\n")

	// Tree pane
	treeLabel := "  TREE"
	if m.active == paneTree {
		treeLabel = StylePrimary().Render("  TREE")
	} else {
		treeLabel = StyleTextMuted().Render("  TREE")
	}
	b.WriteString(treeLabel + "\n")
	b.WriteString(m.tree.View() + "\n")

	// Separator
	sep := StyleSeparator.Render(strings.Repeat("─", m.width))
	b.WriteString(sep + "\n")

	// Log pane
	logLabel := "  LOG"
	if m.active == paneLog {
		logLabel = StylePrimary().Render("  LOG")
	} else {
		logLabel = StyleTextMuted().Render("  LOG")
	}
	b.WriteString(logLabel + "\n")
	b.WriteString(m.log.View() + "\n")

	// Help bar
	sep2 := StyleSeparator.Render(strings.Repeat("─", m.width))
	b.WriteString(sep2 + "\n")
	help := helpLine("tab", "switch pane", "enter", "invoke", "j/k", "navigate", "d", "disconnect", "q", "quit")
	b.WriteString("  " + help)

	return b.String()
}

func StyleTextMuted() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(ColorTextMuted)
}
