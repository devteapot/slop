package slop

import "testing"

func TestValidateParams(t *testing.T) {
	// nil schema -> ok
	if got := ValidateParams(nil, map[string]any{"x": 1}); got != "" {
		t.Fatalf("nil schema should be ok, got %q", got)
	}

	// required
	got := ValidateParams(map[string]any{"type": "object", "required": []any{"body"}}, map[string]any{})
	if got == "" {
		t.Fatalf("expected required error")
	}

	// wrong type
	schema := map[string]any{
		"type":       "object",
		"properties": map[string]any{"count": map[string]any{"type": "integer"}},
	}
	got = ValidateParams(schema, map[string]any{"count": "nope"})
	if got == "" {
		t.Fatalf("expected type error")
	}

	// array items
	schema = map[string]any{
		"type":       "object",
		"properties": map[string]any{"tags": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}},
	}
	if got := ValidateParams(schema, map[string]any{"tags": []any{"a", "b"}}); got != "" {
		t.Fatalf("expected ok, got %q", got)
	}
	if got := ValidateParams(schema, map[string]any{"tags": []any{"a", 2}}); got == "" {
		t.Fatalf("expected failure on tags[1]")
	}
}
