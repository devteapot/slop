package slop

import (
	"encoding/json"
	"strings"
)

// StateMirror maintains a local copy of a SLOP state tree, kept in sync via
// snapshots and JSON-patch operations from a provider.
type StateMirror struct {
	tree    WireNode
	version int
}

// NewStateMirror creates a StateMirror initialized with the given tree and version.
func NewStateMirror(tree WireNode, version int) *StateMirror {
	return &StateMirror{tree: cloneWireNode(tree), version: version}
}

// Tree returns the current state tree.
func (sm *StateMirror) Tree() WireNode {
	return sm.tree
}

// Version returns the current tree version.
func (sm *StateMirror) Version() int {
	return sm.version
}

// ApplyPatch applies a slice of JSON-patch operations and updates the version.
// Paths use node IDs to navigate children (not array indices).
func (sm *StateMirror) ApplyPatch(ops []PatchOp, version int) {
	for _, op := range ops {
		sm.applyOp(op)
	}
	sm.version = version
}

func (sm *StateMirror) applyOp(op PatchOp) {
	path := strings.TrimPrefix(op.Path, "/")
	segments := splitPath(path)

	switch op.Op {
	case "add":
		sm.applyAdd(segments, op.Value)
	case "remove":
		sm.applyRemove(segments)
	case "replace":
		sm.applyReplace(segments, op.Value)
	}
}

func (sm *StateMirror) applyAdd(segments []string, value any) {
	if len(segments) == 0 {
		return
	}

	node, remaining := sm.navigateTo(segments[:len(segments)-1])
	if node == nil || len(remaining) > 0 {
		return
	}

	lastSeg := segments[len(segments)-1]

	// Adding to children
	if len(segments) >= 2 && segments[len(segments)-2] == "children" {
		child := unmarshalWireNode(value)
		if child.ID == "" {
			child.ID = lastSeg
		}
		node.Children = append(node.Children, child)
		return
	}

	// Adding a property
	if len(segments) >= 2 && segments[len(segments)-2] == "properties" {
		if node.Properties == nil {
			node.Properties = Props{}
		}
		node.Properties[lastSeg] = value
		return
	}

	// Adding affordances list
	if lastSeg == "affordances" {
		var affs []Affordance
		data, _ := json.Marshal(value)
		_ = json.Unmarshal(data, &affs)
		node.Affordances = affs
		return
	}

	// Adding meta
	if lastSeg == "meta" {
		var meta WireMeta
		data, _ := json.Marshal(value)
		_ = json.Unmarshal(data, &meta)
		node.Meta = &meta
		return
	}
}

func (sm *StateMirror) applyRemove(segments []string) {
	if len(segments) == 0 {
		return
	}

	node, remaining := sm.navigateTo(segments[:len(segments)-1])
	if node == nil || len(remaining) > 0 {
		return
	}

	lastSeg := segments[len(segments)-1]

	// Removing a child by ID
	if len(segments) >= 2 && segments[len(segments)-2] == "children" {
		filtered := node.Children[:0]
		for _, c := range node.Children {
			if c.ID != lastSeg {
				filtered = append(filtered, c)
			}
		}
		node.Children = filtered
		return
	}

	// Removing a property
	if len(segments) >= 2 && segments[len(segments)-2] == "properties" {
		delete(node.Properties, lastSeg)
		return
	}

	// Removing affordances
	if lastSeg == "affordances" {
		node.Affordances = nil
		return
	}

	// Removing meta
	if lastSeg == "meta" {
		node.Meta = nil
		return
	}
}

func (sm *StateMirror) applyReplace(segments []string, value any) {
	if len(segments) == 0 {
		return
	}

	node, remaining := sm.navigateTo(segments[:len(segments)-1])
	if node == nil || len(remaining) > 0 {
		return
	}

	lastSeg := segments[len(segments)-1]

	// Replacing a property value
	if len(segments) >= 2 && segments[len(segments)-2] == "properties" {
		if node.Properties == nil {
			node.Properties = Props{}
		}
		node.Properties[lastSeg] = value
		return
	}

	// Replacing affordances
	if lastSeg == "affordances" {
		var affs []Affordance
		data, _ := json.Marshal(value)
		_ = json.Unmarshal(data, &affs)
		node.Affordances = affs
		return
	}

	// Replacing meta
	if lastSeg == "meta" {
		var meta WireMeta
		data, _ := json.Marshal(value)
		_ = json.Unmarshal(data, &meta)
		node.Meta = &meta
		return
	}
}

// navigateTo walks the tree following the given path segments.
// Children are navigated by ID (the segment after "children").
// Returns the target node and any remaining unprocessed segments.
func (sm *StateMirror) navigateTo(segments []string) (*WireNode, []string) {
	current := &sm.tree
	i := 0
	for i < len(segments) {
		seg := segments[i]
		switch seg {
		case "children":
			// Next segment is the child ID
			if i+1 >= len(segments) {
				return current, segments[i:]
			}
			childID := segments[i+1]
			found := false
			for j := range current.Children {
				if current.Children[j].ID == childID {
					current = &current.Children[j]
					found = true
					break
				}
			}
			if !found {
				return nil, segments[i:]
			}
			i += 2
		case "properties", "affordances", "meta":
			// These are leaf navigations; return the current node
			return current, segments[i:]
		default:
			return nil, segments[i:]
		}
	}
	return current, nil
}

// splitPath splits a slash-separated path, filtering empty segments.
func splitPath(path string) []string {
	parts := strings.Split(path, "/")
	var out []string
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// unmarshalWireNode converts an arbitrary value (typically map[string]any) to a WireNode.
func unmarshalWireNode(value any) WireNode {
	var node WireNode
	data, _ := json.Marshal(value)
	_ = json.Unmarshal(data, &node)
	return node
}
