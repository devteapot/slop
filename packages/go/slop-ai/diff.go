package slop

import (
	"encoding/json"
	"fmt"
	"strings"
)

// escapePointerSegment applies RFC 6901 JSON Pointer escaping for use inside
// reserved field segments (properties, meta). Node ID segments must not
// contain '/' or '~' and are not escaped.
func escapePointerSegment(key string) string {
	key = strings.ReplaceAll(key, "~", "~0")
	key = strings.ReplaceAll(key, "/", "~1")
	return key
}

// unescapePointerSegment reverses escapePointerSegment.
func unescapePointerSegment(segment string) string {
	segment = strings.ReplaceAll(segment, "~1", "/")
	segment = strings.ReplaceAll(segment, "~0", "~")
	return segment
}

// diffNodes recursively diffs two WireNode trees and returns JSON Patch operations.
// Paths use node IDs for children segments (not array indices).
func diffNodes(old, new *WireNode, basePath string) []PatchOp {
	var ops []PatchOp

	// Properties — key by key
	oldProps := old.Properties
	newProps := new.Properties
	if oldProps == nil {
		oldProps = Props{}
	}
	if newProps == nil {
		newProps = Props{}
	}

	allKeys := map[string]bool{}
	for k := range oldProps {
		allKeys[k] = true
	}
	for k := range newProps {
		allKeys[k] = true
	}

	for key := range allKeys {
		oldVal, oldOk := oldProps[key]
		newVal, newOk := newProps[key]
		path := fmt.Sprintf("%s/properties/%s", basePath, escapePointerSegment(key))

		if !oldOk && newOk {
			ops = append(ops, PatchOp{Op: "add", Path: path, Value: newVal})
		} else if oldOk && !newOk {
			ops = append(ops, PatchOp{Op: "remove", Path: path})
		} else if oldOk && newOk && !jsonEqual(oldVal, newVal) {
			ops = append(ops, PatchOp{Op: "replace", Path: path, Value: newVal})
		}
	}

	// Affordances — replace entire list
	if !jsonEqual(old.Affordances, new.Affordances) {
		path := basePath + "/affordances"
		if new.Affordances != nil {
			op := "add"
			if old.Affordances != nil {
				op = "replace"
			}
			ops = append(ops, PatchOp{Op: op, Path: path, Value: new.Affordances})
		} else if old.Affordances != nil {
			ops = append(ops, PatchOp{Op: "remove", Path: path})
		}
	}

	// Meta — replace entire object
	if !jsonEqual(old.Meta, new.Meta) {
		path := basePath + "/meta"
		if new.Meta != nil {
			op := "add"
			if old.Meta != nil {
				op = "replace"
			}
			ops = append(ops, PatchOp{Op: op, Path: path, Value: new.Meta})
		} else if old.Meta != nil {
			ops = append(ops, PatchOp{Op: "remove", Path: path})
		}
	}

	// Children — by ID
	oldMap := map[string]*WireNode{}
	for i := range old.Children {
		oldMap[old.Children[i].ID] = &old.Children[i]
	}
	newMap := map[string]*WireNode{}
	for i := range new.Children {
		newMap[new.Children[i].ID] = &new.Children[i]
	}

	// Children: emit remove/add(index)/move so that the consumer reconstructs
	// the exact target order.
	working := make([]string, 0, len(old.Children))
	for _, child := range old.Children {
		if _, ok := newMap[child.ID]; !ok {
			ops = append(ops, PatchOp{
				Op:   "remove",
				Path: fmt.Sprintf("%s/%s", basePath, child.ID),
			})
		} else {
			working = append(working, child.ID)
		}
	}

	for i := range new.Children {
		child := new.Children[i]
		if _, ok := oldMap[child.ID]; !ok {
			idx := i
			ops = append(ops, PatchOp{
				Op:    "add",
				Path:  fmt.Sprintf("%s/%s", basePath, child.ID),
				Value: child,
				Index: &idx,
			})
			// insert into working at position i
			working = append(working, "")
			copy(working[i+1:], working[i:])
			working[i] = child.ID
		}
	}

	for i := range new.Children {
		target := new.Children[i].ID
		if i < len(working) && working[i] == target {
			continue
		}
		currentIdx := -1
		for j := i; j < len(working); j++ {
			if working[j] == target {
				currentIdx = j
				break
			}
		}
		if currentIdx == -1 {
			continue
		}
		idx := i
		ops = append(ops, PatchOp{
			Op:    "move",
			Path:  fmt.Sprintf("%s/%s", basePath, target),
			Index: &idx,
		})
		// move working[currentIdx] to position i
		id := working[currentIdx]
		working = append(working[:currentIdx], working[currentIdx+1:]...)
		working = append(working, "")
		copy(working[i+1:], working[i:])
		working[i] = id
	}

	// Recursively diff shared children
	for _, child := range new.Children {
		if oldChild, ok := oldMap[child.ID]; ok {
			childPath := fmt.Sprintf("%s/%s", basePath, child.ID)
			ops = append(ops, diffNodes(oldChild, &child, childPath)...)
		}
	}

	return ops
}

func jsonEqual(a, b any) bool {
	aj, _ := json.Marshal(a)
	bj, _ := json.Marshal(b)
	return string(aj) == string(bj)
}
