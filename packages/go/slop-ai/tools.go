package slop

import (
	"fmt"
	"regexp"
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

// ToolSet holds LLM tools and a resolver to map tool names back to path + action.
type ToolSet struct {
	Tools      []LlmTool
	resolveMap map[string]ToolResolution
}

// ToolResolution holds the path and action for a tool name.
type ToolResolution struct {
	Path   string
	Action string
}

// Resolve maps a tool name back to its path and action for invoke messages.
func (ts *ToolSet) Resolve(toolName string) (ToolResolution, bool) {
	r, ok := ts.resolveMap[toolName]
	return r, ok
}

var sanitizeRe = regexp.MustCompile(`[^a-zA-Z0-9]`)

func sanitize(s string) string {
	return sanitizeRe.ReplaceAllString(s, "_")
}

type toolEntry struct {
	shortName string
	path      string
	action    string
	ancestors []string
	aff       Affordance
}

// AffordancesToTools walks the tree and collects affordances as LLM tools.
// Tool names use short {nodeId}__{action} format. Collisions are disambiguated
// by prepending parent IDs.
func AffordancesToTools(node WireNode, path string) *ToolSet {
	var entries []toolEntry
	collectAffordances(node, path, nil, &entries)

	nameMap := disambiguate(entries)

	ts := &ToolSet{resolveMap: make(map[string]ToolResolution)}

	for i, e := range entries {
		toolName := nameMap[i]
		ts.resolveMap[toolName] = ToolResolution{Path: e.path, Action: e.action}

		desc := e.aff.Description
		if desc == "" {
			desc = e.aff.Label
		}
		if desc == "" {
			desc = fmt.Sprintf("Invoke %s on %s", e.aff.Action, e.path)
		}
		p := e.path
		if p == "" {
			p = "/"
		}
		desc += fmt.Sprintf(" (on %s)", p)
		if e.aff.Dangerous {
			desc += " [DANGEROUS - confirm first]"
		}

		params := e.aff.Params
		if params == nil {
			params = map[string]any{"type": "object", "properties": map[string]any{}}
		}

		ts.Tools = append(ts.Tools, LlmTool{
			Type: "function",
			Function: LlmFunction{
				Name:        toolName,
				Description: desc,
				Parameters:  params,
			},
		})
	}

	return ts
}

func collectAffordances(node WireNode, path string, ancestors []string, out *[]toolEntry) {
	safeID := sanitize(node.ID)
	for _, aff := range node.Affordances {
		safeAction := sanitize(aff.Action)
		anc := make([]string, len(ancestors))
		for i, a := range ancestors {
			anc[i] = sanitize(a)
		}
		p := path
		if p == "" {
			p = "/"
		}
		*out = append(*out, toolEntry{
			shortName: safeID + "__" + safeAction,
			path:      p,
			action:    aff.Action,
			ancestors: anc,
			aff:       aff,
		})
	}
	for _, child := range node.Children {
		collectAffordances(child, path+"/"+child.ID, append(ancestors, node.ID), out)
	}
}

func disambiguate(entries []toolEntry) []string {
	result := make([]string, len(entries))

	// Group by short name to find collisions
	groups := make(map[string][]int)
	for i, e := range entries {
		groups[e.shortName] = append(groups[e.shortName], i)
	}

	for shortName, indices := range groups {
		if len(indices) == 1 {
			result[indices[0]] = shortName
			continue
		}
		// Collision — prepend ancestors until unique
		for _, idx := range indices {
			e := entries[idx]
			name := shortName
			for i := len(e.ancestors) - 1; i >= 0; i-- {
				name = e.ancestors[i] + "__" + name
				// Check if unique among collision group
				unique := true
				for _, other := range indices {
					if other == idx {
						continue
					}
					oe := entries[other]
					oName := oe.shortName
					depth := len(e.ancestors) - 1 - i
					for j := len(oe.ancestors) - 1; j >= 0 && j >= len(oe.ancestors)-1-depth; j-- {
						oName = oe.ancestors[j] + "__" + oName
					}
					if oName == name {
						unique = false
						break
					}
				}
				if unique {
					break
				}
			}
			result[idx] = name
		}
	}

	return result
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
