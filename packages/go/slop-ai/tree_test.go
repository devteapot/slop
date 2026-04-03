package slop

import "testing"

func TestTreeSingleRegistration(t *testing.T) {
	tree, _ := assembleTree(
		map[string]Node{"inbox": {Type: "group", Props: Props{"label": "Inbox"}}},
		"app", "My App",
	)
	if tree.ID != "app" {
		t.Fatalf("expected root id 'app', got %q", tree.ID)
	}
	if tree.Type != "root" {
		t.Fatalf("expected root type, got %q", tree.Type)
	}
	if len(tree.Children) != 1 {
		t.Fatalf("expected 1 child, got %d", len(tree.Children))
	}
	if tree.Children[0].ID != "inbox" {
		t.Fatalf("expected inbox, got %q", tree.Children[0].ID)
	}
}

func TestTreeNestedPaths(t *testing.T) {
	tree, _ := assembleTree(
		map[string]Node{
			"inbox":          {Type: "group"},
			"inbox/messages": {Type: "collection", Props: Props{"count": 5}},
		},
		"app", "App",
	)
	if len(tree.Children) != 1 {
		t.Fatalf("expected 1 top-level child, got %d", len(tree.Children))
	}
	inbox := tree.Children[0]
	if inbox.ID != "inbox" {
		t.Fatalf("expected inbox, got %q", inbox.ID)
	}
	if len(inbox.Children) != 1 {
		t.Fatalf("expected 1 child of inbox, got %d", len(inbox.Children))
	}
	if inbox.Children[0].ID != "messages" {
		t.Fatalf("expected messages, got %q", inbox.Children[0].ID)
	}
}

func TestTreeSyntheticPlaceholders(t *testing.T) {
	tree, _ := assembleTree(
		map[string]Node{"a/b/c": {Type: "item", Props: Props{"x": 1}}},
		"root", "Root",
	)
	a := tree.Children[0]
	if a.ID != "a" || a.Type != "group" {
		t.Fatalf("expected synthetic 'a' group, got %q %q", a.ID, a.Type)
	}
	if a.Properties != nil {
		t.Fatal("synthetic should have no properties")
	}
	b := a.Children[0]
	if b.ID != "b" {
		t.Fatalf("expected 'b', got %q", b.ID)
	}
	c := b.Children[0]
	if c.ID != "c" || c.Type != "item" {
		t.Fatalf("expected item 'c', got %q %q", c.ID, c.Type)
	}
}

func TestTreeMultipleTopLevel(t *testing.T) {
	tree, _ := assembleTree(
		map[string]Node{
			"inbox":    {Type: "group"},
			"settings": {Type: "group"},
			"profile":  {Type: "group"},
		},
		"app", "App",
	)
	if len(tree.Children) != 3 {
		t.Fatalf("expected 3 children, got %d", len(tree.Children))
	}
}

func TestTreeDeepNesting(t *testing.T) {
	tree, _ := assembleTree(
		map[string]Node{
			"a":       {Type: "group"},
			"a/b":     {Type: "group"},
			"a/b/c":   {Type: "group"},
			"a/b/c/d": {Type: "item", Props: Props{"deep": true}},
		},
		"root", "Root",
	)
	d := tree.Children[0].Children[0].Children[0].Children[0]
	if d.ID != "d" {
		t.Fatalf("expected 'd', got %q", d.ID)
	}
	if d.Properties["deep"] != true {
		t.Fatal("expected deep=true")
	}
}
