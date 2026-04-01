package tui

import "github.com/charmbracelet/lipgloss"

// Design System — "Nocturnal Observer" palette from DESIGN.md
var (
	// Surfaces (tonal layering)
	ColorSurface              = lipgloss.Color("#111319")
	ColorSurfaceContainerLow  = lipgloss.Color("#151821")
	ColorSurfaceContainer     = lipgloss.Color("#1a1d27")
	ColorSurfaceContainerHigh = lipgloss.Color("#1f2330")
	ColorSurfaceVariant       = lipgloss.Color("#2a2e3a")

	// Accent
	ColorPrimary          = lipgloss.Color("#91db37")
	ColorPrimaryContainer = lipgloss.Color("#6ba31e")
	ColorSecondary        = lipgloss.Color("#adc6ff")
	ColorDanger           = lipgloss.Color("#ff4466")

	// Text
	ColorTextPrimary   = lipgloss.Color("#e2e4ea")
	ColorTextSecondary = lipgloss.Color("#8b90a0")
	ColorTextMuted     = lipgloss.Color("#555a6e")
)

// Node type styles
var (
	StyleRoot         = lipgloss.NewStyle().Foreground(ColorTextPrimary).Bold(true)
	StyleCollection   = lipgloss.NewStyle().Foreground(ColorSecondary)
	StyleItem         = lipgloss.NewStyle().Foreground(ColorTextPrimary)
	StyleView         = lipgloss.NewStyle().Foreground(ColorSecondary).Faint(true)
	StyleDocument     = lipgloss.NewStyle().Foreground(ColorTextPrimary)
	StyleForm         = lipgloss.NewStyle().Foreground(ColorPrimaryContainer)
	StyleField        = lipgloss.NewStyle().Foreground(ColorPrimaryContainer)
	StyleNotification = lipgloss.NewStyle().Foreground(ColorDanger)
	StyleStatus       = lipgloss.NewStyle().Foreground(ColorTextSecondary)
	StyleGroup        = lipgloss.NewStyle().Foreground(ColorTextMuted)
	StyleControl      = lipgloss.NewStyle().Foreground(ColorPrimary)
	StyleMedia        = lipgloss.NewStyle().Foreground(ColorSecondary)
	StyleContext      = lipgloss.NewStyle().Foreground(ColorTextMuted)
)

// UI element styles
var (
	StyleAffordance = lipgloss.NewStyle().Foreground(ColorPrimary)
	StyleProperty   = lipgloss.NewStyle().Foreground(ColorTextSecondary)
	StyleChanged    = lipgloss.NewStyle().Foreground(ColorPrimary)
	StyleUrgent     = lipgloss.NewStyle().Foreground(ColorDanger).Bold(true)
	StyleTimestamp  = lipgloss.NewStyle().Foreground(ColorTextMuted)

	// Event log message types
	StyleLogSnapshot = lipgloss.NewStyle().Foreground(ColorPrimary)
	StyleLogPatch    = lipgloss.NewStyle().Foreground(ColorSecondary)
	StyleLogError    = lipgloss.NewStyle().Foreground(ColorDanger)
	StyleLogEvent    = lipgloss.NewStyle().Foreground(ColorTextSecondary)

	// Layout
	StyleHeader = lipgloss.NewStyle().
			Background(ColorSurfaceContainer).
			Foreground(ColorTextPrimary).
			Bold(true).
			Padding(0, 1)

	StyleSeparator = lipgloss.NewStyle().Foreground(ColorSurfaceVariant)

	StyleSelectedItem = lipgloss.NewStyle().Background(ColorSurfaceContainer)

	StyleHelpKey = lipgloss.NewStyle().Foreground(ColorPrimary)
	StyleHelpDesc = lipgloss.NewStyle().Foreground(ColorTextMuted)

	StyleTitle = lipgloss.NewStyle().
			Foreground(ColorPrimary).
			Bold(true)

	StyleSubtitle = lipgloss.NewStyle().
			Foreground(ColorTextSecondary)
)

// NodeStyle returns the appropriate style for a node type.
func NodeStyle(nodeType string) lipgloss.Style {
	switch nodeType {
	case "root":
		return StyleRoot
	case "collection":
		return StyleCollection
	case "item":
		return StyleItem
	case "view":
		return StyleView
	case "document":
		return StyleDocument
	case "form":
		return StyleForm
	case "field":
		return StyleField
	case "notification":
		return StyleNotification
	case "status":
		return StyleStatus
	case "group":
		return StyleGroup
	case "control":
		return StyleControl
	case "media":
		return StyleMedia
	case "context":
		return StyleContext
	default:
		return StyleItem
	}
}
