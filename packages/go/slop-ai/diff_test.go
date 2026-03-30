package slop

import "testing"

func TestDiffNoChanges(t *testing.T) {
	n := WireNode{ID: "x", Type: "group", Properties: Props{"a": 1}}
	ops := diffNodes(&n, &n, "")
	if len(ops) != 0 {
		t.Fatalf("expected 0 ops, got %d", len(ops))
	}
}

func TestDiffPropertyAdded(t *testing.T) {
	old := WireNode{ID: "x", Type: "group", Properties: Props{"a": 1}}
	new := WireNode{ID: "x", Type: "group", Properties: Props{"a": 1, "b": 2}}
	ops := diffNodes(&old, &new, "")
	if len(ops) != 1 {
		t.Fatalf("expected 1 op, got %d", len(ops))
	}
	if ops[0].Op != "add" || ops[0].Path != "/properties/b" {
		t.Fatalf("unexpected op: %+v", ops[0])
	}
}

func TestDiffPropertyRemoved(t *testing.T) {
	old := WireNode{ID: "x", Type: "group", Properties: Props{"a": 1, "b": 2}}
	new := WireNode{ID: "x", Type: "group", Properties: Props{"a": 1}}
	ops := diffNodes(&old, &new, "")
	if len(ops) != 1 {
		t.Fatalf("expected 1 op, got %d", len(ops))
	}
	if ops[0].Op != "remove" || ops[0].Path != "/properties/b" {
		t.Fatalf("unexpected op: %+v", ops[0])
	}
}

func TestDiffPropertyChanged(t *testing.T) {
	old := WireNode{ID: "x", Type: "group", Properties: Props{"a": 1}}
	new := WireNode{ID: "x", Type: "group", Properties: Props{"a": 2}}
	ops := diffNodes(&old, &new, "")
	if len(ops) != 1 {
		t.Fatalf("expected 1 op, got %d", len(ops))
	}
	if ops[0].Op != "replace" {
		t.Fatalf("expected replace, got %s", ops[0].Op)
	}
}

func TestDiffChildAdded(t *testing.T) {
	old := WireNode{ID: "x", Type: "group", Children: []WireNode{}}
	new := WireNode{ID: "x", Type: "group", Children: []WireNode{
		{ID: "c1", Type: "item"},
	}}
	ops := diffNodes(&old, &new, "")
	if len(ops) != 1 || ops[0].Op != "add" || ops[0].Path != "/children/c1" {
		t.Fatalf("unexpected ops: %+v", ops)
	}
}

func TestDiffChildRemoved(t *testing.T) {
	old := WireNode{ID: "x", Type: "group", Children: []WireNode{
		{ID: "c1", Type: "item"},
	}}
	new := WireNode{ID: "x", Type: "group", Children: []WireNode{}}
	ops := diffNodes(&old, &new, "")
	if len(ops) != 1 || ops[0].Op != "remove" || ops[0].Path != "/children/c1" {
		t.Fatalf("unexpected ops: %+v", ops)
	}
}

func TestDiffNestedChange(t *testing.T) {
	old := WireNode{ID: "root", Type: "root", Children: []WireNode{
		{ID: "a", Type: "group", Children: []WireNode{
			{ID: "b", Type: "item", Properties: Props{"x": 1}},
		}},
	}}
	new := WireNode{ID: "root", Type: "root", Children: []WireNode{
		{ID: "a", Type: "group", Children: []WireNode{
			{ID: "b", Type: "item", Properties: Props{"x": 2}},
		}},
	}}
	ops := diffNodes(&old, &new, "")
	if len(ops) != 1 {
		t.Fatalf("expected 1 op, got %d", len(ops))
	}
	if ops[0].Path != "/children/a/children/b/properties/x" {
		t.Fatalf("unexpected path: %s", ops[0].Path)
	}
}

func TestDiffMetaChanged(t *testing.T) {
	sal1 := 0.5
	sal2 := 0.9
	old := WireNode{ID: "x", Type: "group", Meta: &WireMeta{Salience: &sal1}}
	new := WireNode{ID: "x", Type: "group", Meta: &WireMeta{Salience: &sal2}}
	ops := diffNodes(&old, &new, "")
	if len(ops) != 1 || ops[0].Op != "replace" || ops[0].Path != "/meta" {
		t.Fatalf("unexpected ops: %+v", ops)
	}
}
