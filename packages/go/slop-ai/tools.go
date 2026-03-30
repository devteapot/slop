package slop

import (
	"fmt"
	"strings"
)

// LlmTool represents a function tool for LLM integration.
type LlmTool struct {
	Type     string      `json:"type"`
	Function LlmFunction `json:"function"`
}

// LlmFunction describes a tool function for LLM tool-use.
type LlmFunction struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Parameters  any    `json:"parameters"`
}

// AffordancesToTools walks the tree and collects affordances as LLM tools.
// The path parameter is the slash-separated path to the node (e.g. "/root/inbox").
func AffordancesToTools(node WireNode, path string) []LlmTool {
	var tools []LlmTool

	for _, aff := range node.Affordances {
		desc := aff.Description
		if desc == "" {
			desc = aff.Label
		}
		if desc == "" {
			desc = fmt.Sprintf("Invoke %s on %s", aff.Action, path)
		}

		params := aff.Params
		if params == nil {
			params = map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			}
		}

		tools = append(tools, LlmTool{
			Type: "function",
			Function: LlmFunction{
				Name:        EncodeTool(path, aff.Action),
				Description: desc,
				Parameters:  params,
			},
		})
	}

	for _, child := range node.Children {
		childPath := path + "/" + child.ID
		tools = append(tools, AffordancesToTools(child, childPath)...)
	}

	return tools
}

// EncodeTool encodes a path and action as a tool name: "invoke__seg1__seg2__action".
func EncodeTool(path, action string) string {
	parts := []string{"invoke"}
	for _, seg := range strings.Split(path, "/") {
		if seg != "" {
			parts = append(parts, seg)
		}
	}
	parts = append(parts, action)
	return strings.Join(parts, "__")
}

// DecodeTool reverses EncodeTool, returning the original path and action.
func DecodeTool(name string) (path, action string) {
	parts := strings.Split(name, "__")
	// Remove "invoke" prefix
	if len(parts) > 0 && parts[0] == "invoke" {
		parts = parts[1:]
	}
	if len(parts) == 0 {
		return "", ""
	}
	if len(parts) == 1 {
		return "", parts[0]
	}
	action = parts[len(parts)-1]
	path = "/" + strings.Join(parts[:len(parts)-1], "/")
	return path, action
}

// FormatTree formats the tree as readable text for LLM context.
// Each node shows its type, label, extra properties, and available actions.
func FormatTree(node WireNode, indent int) string {
	prefix := strings.Repeat("  ", indent)
	var b strings.Builder

	// [type] label
	label := ""
	if node.Properties != nil {
		if l, ok := node.Properties["label"].(string); ok {
			label = l
		}
	}
	b.WriteString(fmt.Sprintf("%s[%s] %s", prefix, node.Type, label))

	// Extra properties (skip label)
	if node.Properties != nil {
		var extras []string
		for k, v := range node.Properties {
			if k == "label" {
				continue
			}
			extras = append(extras, fmt.Sprintf("%s=%v", k, v))
		}
		if len(extras) > 0 {
			b.WriteString(" (")
			b.WriteString(strings.Join(extras, ", "))
			b.WriteString(")")
		}
	}

	// Actions
	if len(node.Affordances) > 0 {
		b.WriteString("  actions: {")
		var acts []string
		for _, aff := range node.Affordances {
			s := aff.Action
			if aff.Params != nil {
				s += fmt.Sprintf("(%v)", aff.Params)
			}
			acts = append(acts, s)
		}
		b.WriteString(strings.Join(acts, ", "))
		b.WriteString("}")
	}

	b.WriteString("\n")

	for _, child := range node.Children {
		b.WriteString(FormatTree(child, indent+1))
	}

	return b.String()
}
