package slop

import (
	"sort"
	"strings"
)

// assembleTree builds a hierarchical WireNode tree from flat path-based registrations.
// Missing ancestors are created as synthetic placeholder nodes.
func assembleTree(registrations map[string]Node, rootID, rootName string) (WireNode, map[string]Handler) {
	allHandlers := map[string]Handler{}
	nodesByPath := map[string]WireNode{}

	// Sort by depth (shallowest first), then alphabetically
	paths := make([]string, 0, len(registrations))
	for p := range registrations {
		paths = append(paths, p)
	}
	sort.Slice(paths, func(i, j int) bool {
		di := strings.Count(paths[i], "/")
		dj := strings.Count(paths[j], "/")
		if di != dj {
			return di < dj
		}
		return paths[i] < paths[j]
	})

	// Normalize each registration
	for _, path := range paths {
		node := registrations[path]
		id := path
		if idx := strings.LastIndex(path, "/"); idx >= 0 {
			id = path[idx+1:]
		}
		wn, handlers := normalizeDescriptor(path, id, node)
		nodesByPath[path] = wn
		for k, v := range handlers {
			allHandlers[k] = v
		}
	}

	// Root
	root := WireNode{
		ID:         rootID,
		Type:       "root",
		Properties: Props{"label": rootName},
		Children:   []WireNode{},
	}

	// Attach each node to its parent
	for _, path := range paths {
		node := nodesByPath[path]
		delete(nodesByPath, path)

		pp := parentPath(path)
		if pp == "" {
			addChild(&root, node)
		} else {
			ensureNode(pp, nodesByPath, &root)
			parent := findNode(&root, pp)
			if parent != nil {
				addChild(parent, node)
			}
		}
	}

	return root, allHandlers
}

func parentPath(path string) string {
	if idx := strings.LastIndex(path, "/"); idx >= 0 {
		return path[:idx]
	}
	return ""
}

func ensureNode(path string, nodesByPath map[string]WireNode, root *WireNode) {
	if findNode(root, path) != nil {
		return
	}

	// If in nodesByPath, place it
	if node, ok := nodesByPath[path]; ok {
		delete(nodesByPath, path)
		pp := parentPath(path)
		if pp == "" {
			addChild(root, node)
		} else {
			ensureNode(pp, nodesByPath, root)
			if parent := findNode(root, pp); parent != nil {
				addChild(parent, node)
			}
		}
		return
	}

	// Create synthetic placeholder
	id := path
	if idx := strings.LastIndex(path, "/"); idx >= 0 {
		id = path[idx+1:]
	}
	synthetic := WireNode{
		ID:       id,
		Type:     "group",
		Children: []WireNode{},
	}

	pp := parentPath(path)
	if pp == "" {
		addChild(root, synthetic)
	} else {
		ensureNode(pp, nodesByPath, root)
		if parent := findNode(root, pp); parent != nil {
			addChild(parent, synthetic)
		}
	}
}

func findNode(root *WireNode, path string) *WireNode {
	segments := strings.Split(path, "/")
	current := root
	for _, seg := range segments {
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

func addChild(parent *WireNode, child WireNode) {
	for i, existing := range parent.Children {
		if existing.ID == child.ID {
			// If existing was synthetic, transfer its children
			if existing.Type == "group" && existing.Properties == nil {
				if len(existing.Children) > 0 && len(child.Children) == 0 {
					child.Children = existing.Children
				} else if len(existing.Children) > 0 && len(child.Children) > 0 {
					ids := map[string]bool{}
					for _, c := range child.Children {
						ids[c.ID] = true
					}
					for _, ec := range existing.Children {
						if !ids[ec.ID] {
							child.Children = append(child.Children, ec)
						}
					}
				}
			}
			parent.Children[i] = child
			return
		}
	}
	parent.Children = append(parent.Children, child)
}
