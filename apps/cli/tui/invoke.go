package tui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	slop "github.com/slop-ai/slop-go"
)

type InvokeModel struct {
	path        string
	affordances []slop.Affordance
	actionIdx   int
	paramInputs []textinput.Model
	paramNames  []string
	focusIdx    int // 0 = action selector, 1+ = param inputs
	submitted   bool
	result      map[string]any
	err         error
	hasResult   bool
}

func NewInvokeModel(path string, affordances []slop.Affordance) InvokeModel {
	m := InvokeModel{
		path:        path,
		affordances: affordances,
	}
	m.buildParamInputs()
	return m
}

func (m *InvokeModel) buildParamInputs() {
	m.paramInputs = nil
	m.paramNames = nil

	aff := m.affordances[m.actionIdx]
	if aff.Params == nil {
		return
	}

	params, ok := aff.Params.(map[string]any)
	if !ok {
		return
	}

	properties, ok := params["properties"].(map[string]any)
	if !ok {
		return
	}

	for name, defn := range properties {
		ti := textinput.New()
		ti.CharLimit = 512
		ti.Width = 50

		// Extract type info for placeholder
		if prop, ok := defn.(map[string]any); ok {
			typeStr, _ := prop["type"].(string)
			desc, _ := prop["description"].(string)
			if desc != "" {
				ti.Placeholder = desc
			} else if typeStr != "" {
				ti.Placeholder = typeStr
			}
		}

		m.paramNames = append(m.paramNames, name)
		m.paramInputs = append(m.paramInputs, ti)
	}

	// Focus first param if any
	if len(m.paramInputs) > 0 {
		m.focusIdx = 1
		m.paramInputs[0].Focus()
	}
}

func (m InvokeModel) SelectedAction() string {
	return m.affordances[m.actionIdx].Action
}

func (m InvokeModel) CollectParams() map[string]any {
	params := map[string]any{}
	for i, name := range m.paramNames {
		val := m.paramInputs[i].Value()
		if val != "" {
			params[name] = val
		}
	}
	return params
}

func (m *InvokeModel) SetResult(result map[string]any, err error) {
	m.result = result
	m.err = err
	m.hasResult = true
}

func (m InvokeModel) Update(msg tea.KeyMsg) (InvokeModel, tea.Cmd) {
	if m.hasResult {
		// Any key dismisses the result
		return m, nil
	}

	switch {
	case key.Matches(msg, Keys.Tab):
		// Cycle through action selector and param inputs
		if m.focusIdx == 0 {
			// Move to first param
			if len(m.paramInputs) > 0 {
				m.focusIdx = 1
				m.paramInputs[0].Focus()
			}
		} else {
			// Blur current, move to next
			m.paramInputs[m.focusIdx-1].Blur()
			if m.focusIdx < len(m.paramInputs) {
				m.focusIdx++
				m.paramInputs[m.focusIdx-1].Focus()
			} else {
				m.focusIdx = 0
			}
		}
		return m, nil

	case key.Matches(msg, Keys.Enter):
		if m.focusIdx == 0 && len(m.paramInputs) > 0 {
			// Move to first param instead of submitting
			m.focusIdx = 1
			m.paramInputs[0].Focus()
			return m, textinput.Blink
		}

		// Check for dangerous action confirmation
		aff := m.affordances[m.actionIdx]
		if aff.Dangerous {
			// TODO: add confirmation step
		}

		m.submitted = true
		return m, nil
	}

	// If focused on action selector
	if m.focusIdx == 0 {
		switch {
		case key.Matches(msg, Keys.Up), msg.String() == "left":
			if m.actionIdx > 0 {
				m.actionIdx--
				m.buildParamInputs()
			}
		case key.Matches(msg, Keys.Down), msg.String() == "right":
			if m.actionIdx < len(m.affordances)-1 {
				m.actionIdx++
				m.buildParamInputs()
			}
		}
		return m, nil
	}

	// Forward to focused param input
	if m.focusIdx > 0 && m.focusIdx-1 < len(m.paramInputs) {
		var cmd tea.Cmd
		m.paramInputs[m.focusIdx-1], cmd = m.paramInputs[m.focusIdx-1].Update(msg)
		return m, cmd
	}

	return m, nil
}

func (m InvokeModel) View(width, height int) string {
	var b strings.Builder

	// Overlay box
	boxWidth := min(width-8, 70)

	b.WriteString("\n")

	// Title
	title := StyleTitle.Render("Invoke Action")
	pathStr := StyleProperty.Render(m.path)
	b.WriteString(fmt.Sprintf("  %s  %s\n", title, pathStr))

	sep := StyleSeparator.Render(strings.Repeat("─", boxWidth))
	b.WriteString("  " + sep + "\n\n")

	// Action selector
	actionLabel := StyleSubtitle.Render("  Action: ")
	b.WriteString(actionLabel)

	for i, aff := range m.affordances {
		style := lipgloss.NewStyle().Foreground(ColorTextSecondary)
		if i == m.actionIdx {
			if m.focusIdx == 0 {
				style = lipgloss.NewStyle().Foreground(ColorPrimary).Bold(true)
			} else {
				style = lipgloss.NewStyle().Foreground(ColorPrimary)
			}
		}

		name := aff.Action
		if aff.Dangerous {
			name += " ⚠"
		}

		if i == m.actionIdx {
			b.WriteString(style.Render("[" + name + "]"))
		} else {
			b.WriteString(style.Render(" " + name + " "))
		}
	}
	b.WriteString("\n")

	// Description
	aff := m.affordances[m.actionIdx]
	if aff.Description != "" {
		b.WriteString("  " + StyleProperty.Render("  "+aff.Description) + "\n")
	}
	b.WriteString("\n")

	// Parameters
	if len(m.paramInputs) == 0 {
		b.WriteString("  " + StyleTextMuted().Render("  (no parameters required)") + "\n")
	} else {
		b.WriteString("  " + StyleSubtitle.Render("  Parameters:") + "\n\n")
		for i, name := range m.paramNames {
			label := StyleProperty.Render("    " + name + ": ")
			b.WriteString(label + m.paramInputs[i].View() + "\n")
		}
	}
	b.WriteString("\n")

	// Result
	if m.hasResult {
		if m.err != nil {
			b.WriteString("  " + StyleLogError.Render("  Error: "+m.err.Error()) + "\n")
		} else {
			status, _ := m.result["status"].(string)
			b.WriteString("  " + StyleLogSnapshot.Render("  Result: "+status) + "\n")
			if data, ok := m.result["data"]; ok {
				b.WriteString("  " + StyleProperty.Render(fmt.Sprintf("  Data: %v", data)) + "\n")
			}
		}
		b.WriteString("\n")
		b.WriteString("  " + helpLine("esc", "close") + "\n")
	} else {
		// Help
		b.WriteString("  " + helpLine("tab", "next field", "enter", "invoke", "esc", "cancel") + "\n")
	}

	return b.String()
}
