package slop

import "testing"

// Conformance: reserved field keywords (properties, meta, affordances,
// content_ref) take precedence over child-id resolution in patch paths.
// See spec/core/messages.md §patch-path-syntax.

func makeMirror() *StateMirror {
	tree := WireNode{
		ID:   "root",
		Type: "root",
		Children: []WireNode{
			{
				ID:   "todos",
				Type: "collection",
				Children: []WireNode{
					{ID: "t1", Type: "item", Properties: Props{"done": false}},
				},
			},
		},
	}
	return NewStateMirror(tree, 1)
}

func TestAddAffordancesFieldRoutesToFieldNotChildren(t *testing.T) {
	m := makeMirror()
	m.ApplyPatch([]PatchOp{{
		Op:    "add",
		Path:  "/todos/t1/affordances",
		Value: []any{map[string]any{"action": "cancel"}},
	}}, 2)

	t1 := m.Tree().Children[0].Children[0]
	if len(t1.Affordances) != 1 || t1.Affordances[0].Action != "cancel" {
		t.Fatalf("expected one affordance on t1, got %+v", t1.Affordances)
	}
	if len(t1.Children) != 0 {
		t.Fatalf("field add must not create a child, got %d children", len(t1.Children))
	}
}

func TestAddMetaFieldRoutesToFieldNotChildren(t *testing.T) {
	m := makeMirror()
	m.ApplyPatch([]PatchOp{{
		Op:    "add",
		Path:  "/todos/t1/meta",
		Value: map[string]any{"summary": "done"},
	}}, 2)

	t1 := m.Tree().Children[0].Children[0]
	if t1.Meta == nil || t1.Meta.Summary != "done" {
		t.Fatalf("expected meta.summary=done on t1, got %+v", t1.Meta)
	}
	if len(t1.Children) != 0 {
		t.Fatalf("field add must not create a child, got %d children", len(t1.Children))
	}
}

func TestAddContentRefField(t *testing.T) {
	m := makeMirror()
	m.ApplyPatch([]PatchOp{{
		Op:   "add",
		Path: "/todos/t1/content_ref",
		Value: map[string]any{
			"type":    "text",
			"mime":    "text/plain",
			"summary": "42 bytes",
		},
	}}, 2)

	t1 := m.Tree().Children[0].Children[0]
	if t1.ContentRef == nil || t1.ContentRef.MIME != "text/plain" {
		t.Fatalf("expected content_ref on t1, got %+v", t1.ContentRef)
	}
	if len(t1.Children) != 0 {
		t.Fatalf("field add must not create a child, got %d children", len(t1.Children))
	}
}

func TestRemoveContentRefField(t *testing.T) {
	m := makeMirror()
	m.tree.Children[0].Children[0].ContentRef = &WireContentRef{Type: "text", MIME: "text/plain", Summary: "x"}
	m.ApplyPatch([]PatchOp{{
		Op:   "remove",
		Path: "/todos/t1/content_ref",
	}}, 2)

	t1 := m.Tree().Children[0].Children[0]
	if t1.ContentRef != nil {
		t.Fatalf("expected content_ref to be removed, got %+v", t1.ContentRef)
	}
}

func TestNestedPropertyPathRoutesIntoProperties(t *testing.T) {
	// Regression: isFieldPath scans all segments, not just the last.
	m := makeMirror()
	m.ApplyPatch([]PatchOp{{
		Op:    "replace",
		Path:  "/todos/t1/properties/done",
		Value: true,
	}}, 2)

	t1 := m.Tree().Children[0].Children[0]
	if v, _ := t1.Properties["done"].(bool); !v {
		t.Fatalf("expected properties.done=true on t1, got %v", t1.Properties["done"])
	}
}

func TestMoveReordersChildren(t *testing.T) {
	tree := WireNode{
		ID:   "root",
		Type: "root",
		Children: []WireNode{
			{ID: "a", Type: "item"},
			{ID: "b", Type: "item"},
			{ID: "c", Type: "item"},
		},
	}
	m := NewStateMirror(tree, 1)
	idx := 0
	m.ApplyPatch([]PatchOp{{Op: "move", Path: "/c", Index: &idx}}, 2)

	got := []string{}
	for _, c := range m.Tree().Children {
		got = append(got, c.ID)
	}
	want := []string{"c", "a", "b"}
	if len(got) != len(want) {
		t.Fatalf("want %v got %v", want, got)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("want %v got %v", want, got)
		}
	}
}

func TestIndexedAddInsertsAtPosition(t *testing.T) {
	tree := WireNode{
		ID:   "root",
		Type: "root",
		Children: []WireNode{
			{ID: "a", Type: "item"},
			{ID: "c", Type: "item"},
		},
	}
	m := NewStateMirror(tree, 1)
	idx := 1
	m.ApplyPatch([]PatchOp{{
		Op:    "add",
		Path:  "/b",
		Value: map[string]any{"id": "b", "type": "item"},
		Index: &idx,
	}}, 2)
	got := []string{}
	for _, c := range m.Tree().Children {
		got = append(got, c.ID)
	}
	want := []string{"a", "b", "c"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("want %v got %v", want, got)
		}
	}
}
