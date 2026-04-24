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
		sm.applyAdd(segments, op.Value, op.Index)
	case "remove":
		sm.applyRemove(segments)
	case "replace":
		sm.applyReplace(segments, op.Value)
	case "move":
		sm.applyMove(segments, op.Index)
	}
}

func (sm *StateMirror) applyMove(segments []string, index *int) {
	if index == nil || len(segments) == 0 || isFieldPath(segments) {
		return
	}
	childID := segments[len(segments)-1]
	parent, parentRemaining := sm.navigateTo(segments[:len(segments)-1])
	if parent == nil || len(parentRemaining) > 0 {
		return
	}
	currentIdx := -1
	for i, c := range parent.Children {
		if c.ID == childID {
			currentIdx = i
			break
		}
	}
	if currentIdx == -1 {
		return
	}
	child := parent.Children[currentIdx]
	parent.Children = append(parent.Children[:currentIdx], parent.Children[currentIdx+1:]...)
	dest := *index
	if dest < 0 {
		dest = 0
	}
	if dest > len(parent.Children) {
		dest = len(parent.Children)
	}
	parent.Children = append(parent.Children, WireNode{})
	copy(parent.Children[dest+1:], parent.Children[dest:])
	parent.Children[dest] = child
}

func (sm *StateMirror) applyAdd(segments []string, value any, index *int) {
	if len(segments) == 0 {
		return
	}

	node, remaining := sm.navigateTo(segments)

	// navigateTo returned nil — the last segment(s) don't exist yet.
	// Navigate to the parent and add the child there.
	if node == nil {
		parent, parentRemaining := sm.navigateTo(segments[:len(segments)-1])
		if parent == nil || len(parentRemaining) > 0 {
			return
		}
		child := unmarshalWireNode(value)
		if child.ID == "" {
			child.ID = segments[len(segments)-1]
		}
		if index == nil {
			parent.Children = append(parent.Children, child)
		} else {
			dest := *index
			if dest < 0 {
				dest = 0
			}
			if dest > len(parent.Children) {
				dest = len(parent.Children)
			}
			parent.Children = append(parent.Children, WireNode{})
			copy(parent.Children[dest+1:], parent.Children[dest:])
			parent.Children[dest] = child
		}
		return
	}

	// Field-level add: navigateTo stopped at a field boundary
	if len(remaining) > 0 {
		sm.applyFieldAdd(node, remaining, value)
		return
	}
}

func (sm *StateMirror) applyFieldAdd(node *WireNode, fieldPath []string, value any) {
	if len(fieldPath) == 2 && fieldPath[0] == "properties" {
		if node.Properties == nil {
			node.Properties = Props{}
		}
		node.Properties[unescapePointerSegment(fieldPath[1])] = value
		return
	}
	if len(fieldPath) == 1 && fieldPath[0] == "affordances" {
		var affs []Affordance
		data, _ := json.Marshal(value)
		_ = json.Unmarshal(data, &affs)
		node.Affordances = affs
		return
	}
	if len(fieldPath) == 1 && fieldPath[0] == "meta" {
		var meta WireMeta
		data, _ := json.Marshal(value)
		_ = json.Unmarshal(data, &meta)
		node.Meta = &meta
		return
	}
	if len(fieldPath) == 1 && fieldPath[0] == "content_ref" {
		var cr WireContentRef
		data, _ := json.Marshal(value)
		_ = json.Unmarshal(data, &cr)
		node.ContentRef = &cr
		return
	}
}

func (sm *StateMirror) applyRemove(segments []string) {
	if len(segments) == 0 {
		return
	}

	node, remaining := sm.navigateTo(segments)
	if node == nil {
		return
	}

	// Field-level remove
	if len(remaining) > 0 {
		sm.applyFieldRemove(node, remaining)
		return
	}

	// Removing a child by ID — navigate to parent
	if len(segments) < 2 {
		return
	}
	parent, parentRemaining := sm.navigateTo(segments[:len(segments)-1])
	if parent == nil || len(parentRemaining) > 0 {
		return
	}
	childID := segments[len(segments)-1]
	filtered := parent.Children[:0]
	for _, c := range parent.Children {
		if c.ID != childID {
			filtered = append(filtered, c)
		}
	}
	parent.Children = filtered
}

func (sm *StateMirror) applyFieldRemove(node *WireNode, fieldPath []string) {
	if len(fieldPath) == 2 && fieldPath[0] == "properties" {
		delete(node.Properties, unescapePointerSegment(fieldPath[1]))
		return
	}
	if len(fieldPath) == 1 && fieldPath[0] == "affordances" {
		node.Affordances = nil
		return
	}
	if len(fieldPath) == 1 && fieldPath[0] == "meta" {
		node.Meta = nil
		return
	}
	if len(fieldPath) == 1 && fieldPath[0] == "content_ref" {
		node.ContentRef = nil
		return
	}
}

func (sm *StateMirror) applyReplace(segments []string, value any) {
	if len(segments) == 0 {
		return
	}

	node, remaining := sm.navigateTo(segments)
	if node == nil {
		return
	}

	// Field-level replace
	if len(remaining) > 0 {
		sm.applyFieldReplace(node, remaining, value)
		return
	}
}

func (sm *StateMirror) applyFieldReplace(node *WireNode, fieldPath []string, value any) {
	if len(fieldPath) == 2 && fieldPath[0] == "properties" {
		if node.Properties == nil {
			node.Properties = Props{}
		}
		node.Properties[unescapePointerSegment(fieldPath[1])] = value
		return
	}
	if len(fieldPath) == 1 && fieldPath[0] == "affordances" {
		var affs []Affordance
		data, _ := json.Marshal(value)
		_ = json.Unmarshal(data, &affs)
		node.Affordances = affs
		return
	}
	if len(fieldPath) == 1 && fieldPath[0] == "meta" {
		var meta WireMeta
		data, _ := json.Marshal(value)
		_ = json.Unmarshal(data, &meta)
		node.Meta = &meta
		return
	}
	if len(fieldPath) == 1 && fieldPath[0] == "content_ref" {
		var cr WireContentRef
		data, _ := json.Marshal(value)
		_ = json.Unmarshal(data, &cr)
		node.ContentRef = &cr
		return
	}
}

// isFieldPath checks if the path targets a known node field rather than a child ID.
func isFieldPath(segments []string) bool {
	for _, seg := range segments {
		switch seg {
		case "properties", "meta", "affordances", "content_ref":
			return true
		}
	}
	return false
}

// navigateTo walks the tree following the given path segments.
// Known field segments (properties, meta, affordances, content_ref) stop
// navigation. All other segments are treated as child IDs.
func (sm *StateMirror) navigateTo(segments []string) (*WireNode, []string) {
	current := &sm.tree
	i := 0
	for i < len(segments) {
		seg := segments[i]
		switch seg {
		case "properties", "affordances", "meta", "content_ref":
			// These are field navigations; return the current node
			return current, segments[i:]
		default:
			// Treat as child ID
			found := false
			for j := range current.Children {
				if current.Children[j].ID == seg {
					current = &current.Children[j]
					found = true
					break
				}
			}
			if !found {
				return nil, segments[i:]
			}
			i++
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
