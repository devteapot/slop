package tui

import (
	"fmt"
	"sort"
	"strings"

	"github.com/charmbracelet/lipgloss"
	slop "github.com/slop-ai/slop-go"
)

// FlatNode is a flattened representation of a tree node for cursor navigation.
type FlatNode struct {
	Path        string
	Node        slop.WireNode
	Indent      int
}

// FlattenTree walks the tree depth-first and returns a flat list of nodes.
func FlattenTree(node slop.WireNode, path string, indent int) []FlatNode {
	var result []FlatNode
	nodePath := path
	if path == "" {
		nodePath = "/" + node.ID
	}

	result = append(result, FlatNode{
		Path:   nodePath,
		Node:   node,
		Indent: indent,
	})

	for _, child := range node.Children {
		childPath := nodePath + "/" + child.ID
		result = append(result, FlattenTree(child, childPath, indent+1)...)
	}

	return result
}

// RenderTree renders a colorized tree with cursor highlighting.
func RenderTree(nodes []FlatNode, cursor int, width int) string {
	var b strings.Builder

	for i, fn := range nodes {
		line := renderNode(fn, i == cursor)
		b.WriteString(line)
		b.WriteString("\n")
	}

	return b.String()
}

func renderNode(fn FlatNode, selected bool) string {
	node := fn.Node

	// Cursor indicator or indent
	var prefix string
	if selected {
		if fn.Indent == 0 {
			prefix = StylePrimary().Render("▸ ")
		} else {
			prefix = StylePrimary().Render("▸ ") + strings.Repeat("  ", fn.Indent-1)
		}
	} else {
		prefix = strings.Repeat("  ", fn.Indent+1)
	}

	// Base style for node type
	style := NodeStyle(node.Type)

	// Salience modifiers
	if node.Meta != nil {
		if node.Meta.Salience != nil {
			if *node.Meta.Salience >= 0.7 {
				style = style.Bold(true)
			} else if *node.Meta.Salience <= 0.3 {
				style = lipgloss.NewStyle().Foreground(ColorTextMuted)
			}
		}
		if node.Meta.Urgency == "critical" || node.Meta.Urgency == "high" {
			style = StyleUrgent
		}
	}

	// Changed marker
	changed := ""
	if node.Meta != nil && node.Meta.Changed != nil && *node.Meta.Changed {
		changed = StyleChanged.Render("* ")
	}

	// Type tag
	typeTag := lipgloss.NewStyle().Foreground(ColorTextMuted).Render("[" + node.Type + "]")

	// Label
	label := node.ID
	if node.Properties != nil {
		if l, ok := node.Properties["label"].(string); ok && l != "" {
			label = l
		}
	}
	labelStr := style.Render(label)

	// Properties (skip label)
	propsStr := renderProperties(node.Properties)

	// Affordances
	affStr := ""
	if len(node.Affordances) > 0 {
		var names []string
		for _, aff := range node.Affordances {
			names = append(names, aff.Action)
		}
		affStr = "  " + StyleAffordance.Render("⚡ "+strings.Join(names, ", "))
	}

	// Meta summary
	metaStr := ""
	if node.Meta != nil && node.Meta.Summary != "" {
		metaStr = " " + lipgloss.NewStyle().Foreground(ColorTextMuted).Italic(true).Render(node.Meta.Summary)
	}

	content := fmt.Sprintf("%s%s %s%s%s%s", changed, typeTag, labelStr, propsStr, metaStr, affStr)

	if selected {
		content = StyleSelectedItem.Render(content)
	}

	return prefix + content
}

func renderProperties(props map[string]any) string {
	if props == nil || len(props) == 0 {
		return ""
	}

	var extras []string
	keys := make([]string, 0, len(props))
	for k := range props {
		if k == "label" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, k := range keys {
		v := props[k]
		s := fmt.Sprintf("%s=%v", k, v)
		extras = append(extras, s)
	}

	if len(extras) == 0 {
		return ""
	}

	return " " + StyleProperty.Render("("+strings.Join(extras, ", ")+")")
}

// CountAffordances counts total affordances in the tree.
func CountAffordances(node *slop.WireNode) int {
	if node == nil {
		return 0
	}
	count := len(node.Affordances)
	for _, child := range node.Children {
		count += CountAffordances(&child)
	}
	return count
}
