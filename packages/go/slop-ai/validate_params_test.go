package slop

import "testing"

func TestValidateParams(t *testing.T) {
	// nil schema -> ok
	if got := ValidateParams(nil, map[string]any{"x": 1}); got != "" {
		t.Fatalf("nil schema should be ok, got %q", got)
	}

	// required — []any (JSON-decoded shape)
	got := ValidateParams(map[string]any{"type": "object", "required": []any{"body"}}, map[string]any{})
	if got == "" {
		t.Fatalf("expected required error for []any")
	}

	// required — []string (shape emitted by normalizeParams)
	got = ValidateParams(map[string]any{"type": "object", "required": []string{"body"}}, map[string]any{})
	if got == "" {
		t.Fatalf("expected required error for []string")
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

	// enum — []any (JSON-decoded shape)
	enumSchema := map[string]any{"enum": []any{"open", "closed"}}
	if got := ValidateParams(enumSchema, "open"); got != "" {
		t.Fatalf("expected []any enum match, got %q", got)
	}
	if got := ValidateParams(enumSchema, "other"); got == "" {
		t.Fatalf("expected []any enum mismatch error")
	}

	// enum — []string (shape a Go handler would typically write)
	enumStrSchema := map[string]any{"enum": []string{"open", "closed"}}
	if got := ValidateParams(enumStrSchema, "open"); got != "" {
		t.Fatalf("expected []string enum match, got %q", got)
	}
	if got := ValidateParams(enumStrSchema, "other"); got == "" {
		t.Fatalf("expected []string enum mismatch error")
	}

	// enum — []int (typed numeric slice)
	enumIntSchema := map[string]any{"enum": []int{1, 2, 3}}
	if got := ValidateParams(enumIntSchema, 2); got != "" {
		t.Fatalf("expected []int enum match, got %q", got)
	}
	if got := ValidateParams(enumIntSchema, 99); got == "" {
		t.Fatalf("expected []int enum mismatch error")
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
