package slop

import (
	"strings"
	"testing"
)

// canonicalTree returns the canonical test tree matching
// spec/core/state-tree.md "Consumer display format".
func canonicalTree() WireNode {
	sal := 0.9
	tc142 := 142
	w := [2]int{0, 25}
	tc3 := 3
	return WireNode{
		ID: "store", Type: "root",
		Properties: map[string]any{"label": "Pet Store"},
		Meta:       &WireMeta{Salience: &sal},
		Affordances: []Affordance{{
			Action: "search",
			Params: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query": map[string]any{"type": "string"},
				},
			},
		}},
		Children: []WireNode{
			{
				ID: "catalog", Type: "collection",
				Properties: map[string]any{"label": "Catalog", "count": 142},
				Meta:       &WireMeta{TotalChildren: &tc142, Window: &w, Summary: "142 products, 12 on sale"},
				Children: []WireNode{{
					ID: "prod-1", Type: "item",
					Properties: map[string]any{"label": "Rubber Duck", "price": 4.99, "in_stock": true},
					Affordances: []Affordance{
						{Action: "add_to_cart", Params: map[string]any{
							"type": "object",
							"properties": map[string]any{
								"quantity": map[string]any{"type": "number"},
							},
						}},
						{Action: "view"},
					},
				}},
			},
			{
				ID: "cart", Type: "collection",
				Properties: map[string]any{"label": "Cart"},
				Meta:       &WireMeta{TotalChildren: &tc3, Summary: "3 items, $24.97"},
			},
		},
	}
}

func TestFormatTree_HeaderShowsIdAndLabel(t *testing.T) {
	out := FormatTree(canonicalTree(), 0)
	for _, want := range []string{
		"[root] store: Pet Store",
		"[collection] catalog: Catalog",
		"[item] prod-1: Rubber Duck",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
}

func TestFormatTree_HeaderIdOnlyWhenNoLabel(t *testing.T) {
	node := WireNode{ID: "status", Type: "status", Properties: map[string]any{"code": 200}}
	out := FormatTree(node, 0)
	if !strings.Contains(out, "[status] status") {
		t.Errorf("expected [status] status, got:\n%s", out)
	}
}

func TestFormatTree_ExtraPropsExcludeLabelAndTitle(t *testing.T) {
	out := FormatTree(canonicalTree(), 0)
	if strings.Contains(out, "label=") {
		t.Errorf("label= should be excluded from extra props:\n%s", out)
	}
}

func TestFormatTree_MetaSummaryQuoted(t *testing.T) {
	out := FormatTree(canonicalTree(), 0)
	for _, want := range []string{
		`"142 products, 12 on sale"`,
		`"3 items, $24.97"`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing summary %s in:\n%s", want, out)
		}
	}
}

func TestFormatTree_MetaSalience(t *testing.T) {
	out := FormatTree(canonicalTree(), 0)
	if !strings.Contains(out, "salience=0.9") {
		t.Errorf("missing salience in:\n%s", out)
	}
}

func TestFormatTree_AffordancesInlineWithParams(t *testing.T) {
	out := FormatTree(canonicalTree(), 0)
	if !strings.Contains(out, "actions: {search(query: string)}") {
		t.Errorf("missing search affordance in:\n%s", out)
	}
	if !strings.Contains(out, "add_to_cart(quantity: number)") {
		t.Errorf("missing add_to_cart affordance in:\n%s", out)
	}
	if !strings.Contains(out, ", view}") {
		t.Errorf("missing view affordance in:\n%s", out)
	}
}

func TestFormatTree_WindowedCollection(t *testing.T) {
	out := FormatTree(canonicalTree(), 0)
	if !strings.Contains(out, "(showing 1 of 142)") {
		t.Errorf("missing windowed indicator in:\n%s", out)
	}
}

func TestFormatTree_LazyCollection(t *testing.T) {
	out := FormatTree(canonicalTree(), 0)
	if !strings.Contains(out, "(3 children not loaded)") {
		t.Errorf("missing lazy indicator in:\n%s", out)
	}
}

func TestFormatTree_Indentation(t *testing.T) {
	out := FormatTree(canonicalTree(), 0)
	lines := strings.Split(out, "\n")
	// Root at indent 0
	if !strings.HasPrefix(lines[0], "[root]") {
		t.Errorf("root should be at indent 0: %q", lines[0])
	}
	// Find catalog line at indent 1
	found := false
	for _, line := range lines {
		if strings.Contains(line, "catalog") && strings.HasPrefix(line, "  [collection]") {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("catalog should be at indent 1 (2 spaces):\n%s", out)
	}
}
