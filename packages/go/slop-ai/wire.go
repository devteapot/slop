package slop

// WireNode is the JSON wire format for a SLOP state tree node.
type WireNode struct {
	ID          string          `json:"id"`
	Type        string          `json:"type"`
	Properties  Props           `json:"properties,omitempty"`
	Children    []WireNode      `json:"children,omitempty"`
	Affordances []Affordance    `json:"affordances,omitempty"`
	Meta        *WireMeta       `json:"meta,omitempty"`
	ContentRef  *WireContentRef `json:"content_ref,omitempty"`
}

// WireContentRef is the wire format for a content reference.
type WireContentRef struct {
	Type     string `json:"type"`
	MIME     string `json:"mime"`
	Summary  string `json:"summary"`
	Size     *int   `json:"size,omitempty"`
	URI      string `json:"uri,omitempty"`
	Preview  string `json:"preview,omitempty"`
	Encoding string `json:"encoding,omitempty"`
	Hash     string `json:"hash,omitempty"`
}

// Affordance is an action available on a node (wire format).
type Affordance struct {
	Action      string `json:"action"`
	Label       string `json:"label,omitempty"`
	Description string `json:"description,omitempty"`
	Params      any    `json:"params,omitempty"`
	Dangerous   bool   `json:"dangerous,omitempty"`
	Idempotent  bool   `json:"idempotent,omitempty"`
	Estimate    string `json:"estimate,omitempty"`
}

// WireMeta is the wire format for node metadata.
type WireMeta struct {
	Summary       string   `json:"summary,omitempty"`
	Salience      *float64 `json:"salience,omitempty"`
	Pinned        *bool    `json:"pinned,omitempty"`
	Changed       *bool    `json:"changed,omitempty"`
	Focus         *bool    `json:"focus,omitempty"`
	Urgency       string   `json:"urgency,omitempty"`
	Reason        string   `json:"reason,omitempty"`
	TotalChildren *int     `json:"total_children,omitempty"`
	Window        *[2]int  `json:"window,omitempty"`
	Created       string   `json:"created,omitempty"`
	Updated       string   `json:"updated,omitempty"`
}

// PatchOp is a JSON Patch (RFC 6902) operation.
type PatchOp struct {
	Op    string `json:"op"`              // "add", "remove", "replace"
	Path  string `json:"path"`
	Value any    `json:"value,omitempty"`
}
