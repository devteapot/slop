package discovery

import (
	"context"
	"fmt"
	"strings"

	slop "github.com/devteapot/slop/packages/go/slop-ai"
)

// ToolContent is a text content block for host integrations.
type ToolContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// ToolResult is a host-agnostic tool result payload.
type ToolResult struct {
	Content []ToolContent `json:"content"`
	IsError bool          `json:"isError,omitempty"`
}

// DynamicToolEntry describes a single affordance-backed tool.
type DynamicToolEntry struct {
	Name        string
	Description string
	InputSchema any
	ProviderID  string
	Path        string
	Action      string
}

// DynamicToolResolution resolves a dynamic tool name back to invoke coordinates.
type DynamicToolResolution struct {
	ProviderID string
	Path       string
	Action     string
}

// DynamicToolSet contains all affordance-backed tools across connected providers.
type DynamicToolSet struct {
	Tools      []DynamicToolEntry
	resolveMap map[string]DynamicToolResolution
}

// Resolve maps a dynamic tool name back to invoke coordinates.
func (d DynamicToolSet) Resolve(toolName string) (DynamicToolResolution, bool) {
	resolution, ok := d.resolveMap[toolName]
	return resolution, ok
}

// CreateDynamicTools builds namespaced tool definitions from all connected providers.
func CreateDynamicTools(service *Service) DynamicToolSet {
	entries := []DynamicToolEntry{}
	resolveMap := map[string]DynamicToolResolution{}

	for _, provider := range service.GetProviders() {
		tree := provider.Consumer.Tree(provider.SubscriptionID)
		if tree == nil {
			continue
		}

		prefix := sanitizePrefix(provider.ID)
		toolSet := slop.AffordancesToTools(*tree, "")
		for _, tool := range toolSet.Tools {
			resolution, ok := toolSet.Resolve(tool.Function.Name)
			if !ok {
				continue
			}

			name := prefix + "__" + tool.Function.Name
			entries = append(entries, DynamicToolEntry{
				Name:        name,
				Description: fmt.Sprintf("[%s] %s", provider.Name, tool.Function.Description),
				InputSchema: tool.Function.Parameters,
				ProviderID:  provider.ID,
				Path:        resolution.Path,
				Action:      resolution.Action,
			})
			resolveMap[name] = DynamicToolResolution{
				ProviderID: provider.ID,
				Path:       resolution.Path,
				Action:     resolution.Action,
			}
		}
	}

	return DynamicToolSet{Tools: entries, resolveMap: resolveMap}
}

// ToolHandlers exposes the core discovery tool handlers.
type ToolHandlers struct {
	service *Service
}

// CreateToolHandlers builds the host-agnostic core tool handlers.
func CreateToolHandlers(service *Service) ToolHandlers {
	return ToolHandlers{service: service}
}

// ListApps lists all discovered providers and connection state.
func (h ToolHandlers) ListApps() ToolResult {
	discovered := h.service.GetDiscovered()
	if len(discovered) == 0 {
		return ToolResult{
			Content: []ToolContent{{
				Type: "text",
				Text: "No applications found. Desktop and web apps that support external control will appear here automatically when they're running.",
			}},
		}
	}

	connected := h.service.GetProviders()
	connectedByID := map[string]*ConnectedProvider{}
	for _, provider := range connected {
		connectedByID[provider.ID] = provider
	}

	lines := make([]string, 0, len(discovered))
	for _, desc := range discovered {
		provider := connectedByID[desc.ID]
		tree := (*slop.WireNode)(nil)
		actionCount := 0
		if provider != nil {
			tree = provider.Consumer.Tree(provider.SubscriptionID)
			if tree != nil {
				actionCount = len(slop.AffordancesToTools(*tree, "").Tools)
			}
		}

		label := desc.Name
		if tree != nil {
			if value, ok := tree.Properties["label"].(string); ok && value != "" {
				label = value
			}
		}

		status := "available"
		if provider != nil {
			status = fmt.Sprintf("connected, %d actions", actionCount)
		}

		lines = append(lines, fmt.Sprintf("- **%s** (id: `%s`, %s) - %s", label, desc.ID, desc.Transport.Type, status))
	}

	return ToolResult{
		Content: []ToolContent{{
			Type: "text",
			Text: fmt.Sprintf("Applications on this computer:\n%s\n\nUse connect_app with an app name or ID to connect and inspect it.", strings.Join(lines, "\n")),
		}},
	}
}

// ConnectApp connects to a provider and returns its current state snapshot and actions.
func (h ToolHandlers) ConnectApp(ctx context.Context, app string) ToolResult {
	provider, err := h.service.EnsureConnected(ctx, app)
	if err != nil {
		return ToolResult{Content: []ToolContent{{Type: "text", Text: fmt.Sprintf("Failed to connect to %q: %v", app, err)}}, IsError: true}
	}
	if provider == nil {
		available := make([]string, 0, len(h.service.GetDiscovered()))
		for _, desc := range h.service.GetDiscovered() {
			available = append(available, fmt.Sprintf("%s (%s)", desc.Name, desc.ID))
		}
		return ToolResult{Content: []ToolContent{{Type: "text", Text: fmt.Sprintf("App %q not found. Available: %s", app, strings.Join(available, ", "))}}, IsError: true}
	}

	tree := provider.Consumer.Tree(provider.SubscriptionID)
	if tree == nil {
		return ToolResult{Content: []ToolContent{{Type: "text", Text: fmt.Sprintf("%s is connected but has no state yet.", provider.Name)}}}
	}

	toolSet := slop.AffordancesToTools(*tree, "")
	actions := make([]string, 0, len(toolSet.Tools))
	for _, tool := range toolSet.Tools {
		resolution, ok := toolSet.Resolve(tool.Function.Name)
		action := tool.Function.Name
		pathInfo := ""
		if ok {
			action = resolution.Action
			pathInfo = fmt.Sprintf(" on `%s`", resolution.Path)
		}
		actions = append(actions, fmt.Sprintf("  - **%s**%s: %s", action, pathInfo, tool.Function.Description))
	}

	return ToolResult{
		Content: []ToolContent{{
			Type: "text",
			Text: fmt.Sprintf("## %s\nID: `%s`\n\n### Current State\n```\n%s\n```\n\n### Available Actions (%d)\n%s", provider.Name, provider.ID, slop.FormatTree(*tree, 0), len(toolSet.Tools), strings.Join(actions, "\n")),
		}},
	}
}

// DisconnectApp disconnects an active provider connection.
func (h ToolHandlers) DisconnectApp(app string) ToolResult {
	if !h.service.Disconnect(app) {
		return ToolResult{Content: []ToolContent{{Type: "text", Text: fmt.Sprintf("App %q is not connected. Use list_apps to see available apps.", app)}}, IsError: true}
	}
	return ToolResult{Content: []ToolContent{{Type: "text", Text: fmt.Sprintf("Disconnected from %q. Its tools have been removed.", app)}}}
}

func sanitizePrefix(value string) string {
	var b strings.Builder
	lastUnderscore := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore && b.Len() > 0 {
			b.WriteByte('_')
			lastUnderscore = true
		}
	}
	return strings.Trim(b.String(), "_")
}
