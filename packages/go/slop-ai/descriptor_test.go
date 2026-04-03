package slop

import (
	"testing"
)

func TestNormalizeItemContentRef(t *testing.T) {
	item := Item{
		ID:    "readme",
		Props: Props{"title": "README.md"},
		ContentRef: &ContentRef{
			Type:    "text",
			MIME:    "text/markdown",
			Summary: "Project readme",
		},
	}
	wn, _ := normalizeItem("docs/readme", item)
	if wn.ContentRef == nil {
		t.Fatal("expected item to have content_ref")
	}
	if wn.ContentRef.Type != "text" {
		t.Errorf("expected type 'text', got %q", wn.ContentRef.Type)
	}
	if wn.ContentRef.MIME != "text/markdown" {
		t.Errorf("expected mime 'text/markdown', got %q", wn.ContentRef.MIME)
	}
	if wn.ContentRef.URI != "slop://content/docs/readme" {
		t.Errorf("expected auto-generated URI, got %q", wn.ContentRef.URI)
	}
}

func TestNormalizeParamsArrayItems(t *testing.T) {
	params := map[string]any{
		"tags": map[string]any{
			"type":  "array",
			"items": map[string]any{"type": "string"},
		},
	}
	schema := normalizeParams(params)
	props, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatal("expected properties map")
	}
	tagsProp, ok := props["tags"].(map[string]any)
	if !ok {
		t.Fatal("expected tags property map")
	}
	if tagsProp["type"] != "array" {
		t.Errorf("expected type 'array', got %v", tagsProp["type"])
	}
	items, ok := tagsProp["items"].(map[string]any)
	if !ok {
		t.Fatal("expected items map in array param")
	}
	if items["type"] != "string" {
		t.Errorf("expected items type 'string', got %v", items["type"])
	}
}
