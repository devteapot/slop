// Package slop provides a Go SDK for the SLOP protocol — let AI observe and
// interact with your app's state.
//
// Quick start:
//
//	server := slop.NewServer("my-app", "My App")
//	server.Register("status", slop.Node{
//	    Type: "status",
//	    Props: slop.Props{"healthy": true},
//	})
//	server.Mount(http.DefaultServeMux)
//	http.ListenAndServe(":8080", nil)
package slop

import "context"

// Props is a map of property key-value pairs on a node.
type Props = map[string]any

// Actions maps action names to handlers.
type Actions = map[string]Handler

// Node is a developer-facing descriptor for registering state.
// It describes a node's type, properties, children, and available actions.
type Node struct {
	Type       string          // required: "group", "collection", "status", "view", etc.
	Props      Props           // key-value properties
	Summary    string          // natural language summary
	Items      []Item          // collection items
	Children   map[string]Node // inline child nodes
	Actions    Actions         // action handlers
	Meta       *Meta           // attention/structural metadata
	ContentRef *ContentRef     // large content reference
}

// Item is an element in a collection.
type Item struct {
	ID         string
	Props      Props
	Summary    string
	Actions    Actions
	Children   map[string]Node
	Meta       *Meta
	ContentRef *ContentRef
}

// Handler handles a SLOP action invocation.
// It mirrors the http.Handler pattern.
type Handler interface {
	HandleAction(ctx context.Context, params Params) (any, error)
}

// HandlerFunc is an adapter to allow use of ordinary functions as Handlers.
// If f is a function with the appropriate signature, HandlerFunc(f) is a Handler
// that calls f.
type HandlerFunc func(ctx context.Context, params Params) (any, error)

// HandleAction calls f(ctx, params).
func (f HandlerFunc) HandleAction(ctx context.Context, params Params) (any, error) {
	return f(ctx, params)
}

// Params wraps action parameters with typed accessors.
type Params map[string]any

// String returns the string value for key, or "" if not found.
func (p Params) String(key string) string {
	if v, ok := p[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// Int returns the int value for key, or 0 if not found.
func (p Params) Int(key string) int {
	if v, ok := p[key]; ok {
		switch n := v.(type) {
		case float64:
			return int(n)
		case int:
			return n
		case int64:
			return int(n)
		}
	}
	return 0
}

// Float returns the float64 value for key, or 0 if not found.
func (p Params) Float(key string) float64 {
	if v, ok := p[key]; ok {
		if f, ok := v.(float64); ok {
			return f
		}
	}
	return 0
}

// Bool returns the bool value for key, or false if not found.
func (p Params) Bool(key string) bool {
	if v, ok := p[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
}

// ActionOpts holds metadata for an action registration.
type ActionOpts struct {
	Label       string
	Description string
	Dangerous   bool
	Idempotent  bool
	Estimate    string            // "instant", "fast", "slow", "async"
	Params      map[string]any // simplified param schema: {"title": "string"} or {"tags": ParamDef{...}}
}

// WithOpts wraps a Handler with action metadata, returning a Handler
// that carries the options. Used for inline registration in Node.Actions.
func WithOpts(h Handler, opts ActionOpts) Handler {
	return &optsHandler{handler: h, opts: opts}
}

type optsHandler struct {
	handler Handler
	opts    ActionOpts
}

func (o *optsHandler) HandleAction(ctx context.Context, params Params) (any, error) {
	return o.handler.HandleAction(ctx, params)
}

// Meta holds attention and structural metadata for a node.
type Meta struct {
	Summary       string
	Salience      *float64
	Pinned        *bool
	Changed       *bool
	Focus         *bool
	Urgency       string // "none", "low", "medium", "high", "critical"
	Reason        string
	TotalChildren *int
	Window        *[2]int // [offset, count]
}

// ContentRef references large content that can be fetched on demand.
type ContentRef struct {
	Type     string // "text", "binary", "stream"
	MIME     string
	Summary  string
	Size     *int
	URI      string
	Preview  string
	Encoding string
}
