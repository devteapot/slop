package slop

import (
	"encoding/json"
	"strings"
)

// OutputTreeOptions controls how a tree is prepared for output to a consumer.
type OutputTreeOptions struct {
	MaxDepth    *int      // Maximum depth to resolve
	MaxNodes    *int      // Maximum total nodes
	MinSalience *float64  // Minimum salience threshold
	Types       []string  // Only include these node types
}

// PrepareTree applies filter → truncate → compact to a tree for consumer output.
func PrepareTree(root WireNode, options OutputTreeOptions) WireNode {
	tree := root
	if options.MinSalience != nil || options.Types != nil {
		tree = FilterTree(tree, options.MinSalience, options.Types)
	}
	if options.MaxDepth != nil {
		tree = TruncateTree(tree, *options.MaxDepth)
	}
	if options.MaxNodes != nil {
		tree = AutoCompact(tree, *options.MaxNodes)
	}
	return tree
}

// GetSubtree extracts a subtree by slash-separated node ID path (e.g. "/inbox/msg-42").
func GetSubtree(root *WireNode, path string) *WireNode {
	if path == "" || path == "/" {
		return root
	}
	path = strings.TrimPrefix(path, "/")
	segments := strings.Split(path, "/")
	current := root
	for _, seg := range segments {
		if seg == "" {
			continue
		}
		found := false
		for i := range current.Children {
			if current.Children[i].ID == seg {
				current = &current.Children[i]
				found = true
				break
			}
		}
		if !found {
			return nil
		}
	}
	return current
}

// TruncateTree collapses nodes beyond depth to stubs with meta.total_children.
func TruncateTree(node WireNode, depth int) WireNode {
	if depth <= 0 && len(node.Children) > 0 {
		tc := len(node.Children)
		meta := copyWireMeta(node.Meta)
		if meta == nil {
			meta = &WireMeta{}
		}
		meta.TotalChildren = &tc
		return WireNode{
			ID:         node.ID,
			Type:       node.Type,
			Properties: node.Properties,
			Meta:       meta,
		}
	}
	if len(node.Children) == 0 {
		return node
	}
	out := node
	out.Children = make([]WireNode, len(node.Children))
	for i, c := range node.Children {
		out.Children[i] = TruncateTree(c, depth-1)
	}
	return out
}

// AutoCompact collapses lowest-salience subtrees to fit within a node budget.
// Preserves root children and pinned nodes.
func AutoCompact(root WireNode, maxNodes int) WireNode {
	total := CountNodes(root)
	if total <= maxNodes {
		return root
	}

	var candidates []compactCandidate
	for i := range root.Children {
		collectCandidates(root.Children[i], []int{i}, &candidates, false)
	}

	sortCandidates(candidates)

	tree := cloneWireNode(root)
	nodeCount := total

	for _, c := range candidates {
		if nodeCount <= maxNodes {
			break
		}
		saved := collapseAtPath(&tree, c.path)
		nodeCount -= saved
	}

	return tree
}

// FilterTree removes children below minSalience or not matching types.
// The root node is never filtered.
func FilterTree(node WireNode, minSalience *float64, types []string) WireNode {
	if len(node.Children) == 0 {
		return node
	}

	var filtered []WireNode
	for _, child := range node.Children {
		if minSalience != nil {
			s := 0.5
			if child.Meta != nil && child.Meta.Salience != nil {
				s = *child.Meta.Salience
			}
			if s < *minSalience {
				continue
			}
		}
		if types != nil && !containsString(types, child.Type) {
			continue
		}
		filtered = append(filtered, FilterTree(child, minSalience, types))
	}

	out := node
	if len(filtered) > 0 {
		out.Children = filtered
	} else {
		out.Children = nil
	}
	return out
}

// CountNodes counts total nodes in a tree.
func CountNodes(node WireNode) int {
	count := 1
	for _, c := range node.Children {
		count += CountNodes(c)
	}
	return count
}

// --- Internal helpers ---

type compactCandidate struct {
	path       []int
	score      float64
	childCount int
}

func collectCandidates(node WireNode, path []int, candidates *[]compactCandidate, isRootChild bool) {
	if len(node.Children) == 0 {
		return
	}
	for i, child := range node.Children {
		childPath := make([]int, len(path)+1)
		copy(childPath, path)
		childPath[len(path)] = i

		pinned := child.Meta != nil && child.Meta.Pinned != nil && *child.Meta.Pinned
		if len(child.Children) > 0 && !isRootChild && !pinned {
			childCount := CountNodes(child) - 1
			s := 0.5
			if child.Meta != nil && child.Meta.Salience != nil {
				s = *child.Meta.Salience
			}
			depth := float64(len(childPath))
			score := s - depth*0.01 - float64(childCount)*0.001
			*candidates = append(*candidates, compactCandidate{path: childPath, score: score, childCount: childCount})
		}

		collectCandidates(child, childPath, candidates, false)
	}
}

func sortCandidates(candidates []compactCandidate) {
	for i := 1; i < len(candidates); i++ {
		key := candidates[i]
		j := i - 1
		for j >= 0 && candidates[j].score > key.score {
			candidates[j+1] = candidates[j]
			j--
		}
		candidates[j+1] = key
	}
}

func collapseAtPath(tree *WireNode, path []int) int {
	node := tree
	for i := 0; i < len(path)-1; i++ {
		if path[i] >= len(node.Children) {
			return 0
		}
		node = &node.Children[path[i]]
	}

	idx := path[len(path)-1]
	if idx >= len(node.Children) {
		return 0
	}

	target := &node.Children[idx]
	saved := CountNodes(*target) - 1

	tc := len(target.Children)
	meta := copyWireMeta(target.Meta)
	if meta == nil {
		meta = &WireMeta{}
	}
	meta.TotalChildren = &tc
	if meta.Summary == "" {
		meta.Summary = intToStr(tc) + " children"
	}

	node.Children[idx] = WireNode{
		ID:          target.ID,
		Type:        target.Type,
		Properties:  target.Properties,
		Affordances: target.Affordances,
		Meta:        meta,
	}

	return saved
}

func cloneWireNode(node WireNode) WireNode {
	data, _ := json.Marshal(node)
	var clone WireNode
	_ = json.Unmarshal(data, &clone)
	return clone
}

func copyWireMeta(m *WireMeta) *WireMeta {
	if m == nil {
		return nil
	}
	c := *m
	return &c
}

func containsString(slice []string, s string) bool {
	for _, v := range slice {
		if v == s {
			return true
		}
	}
	return false
}

func intToStr(n int) string {
	if n == 0 {
		return "0"
	}
	digits := []byte{}
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}
