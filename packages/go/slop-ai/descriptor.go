package slop

import "fmt"

// normalizeDescriptor converts a developer-facing Node into a WireNode
// and extracts action handlers into a flat map keyed by "path/action".
func normalizeDescriptor(path, id string, node Node) (WireNode, map[string]Handler) {
	handlers := map[string]Handler{}
	var children []WireNode
	meta := extractMeta(node.Summary, node.Meta)

	// Windowed collection or items → children
	if node.Items != nil {
		for _, item := range node.Items {
			itemPath := item.ID
			if path != "" {
				itemPath = path + "/" + item.ID
			}
			wn, h := normalizeItem(itemPath, item)
			children = append(children, wn)
			for k, v := range h {
				handlers[k] = v
			}
		}
	}

	// Inline children
	for childID, childNode := range node.Children {
		childPath := childID
		if path != "" {
			childPath = path + "/" + childID
		}
		wn, h := normalizeDescriptor(childPath, childID, childNode)
		children = append(children, wn)
		for k, v := range h {
			handlers[k] = v
		}
	}

	// Actions → affordances + handlers
	affordances := normalizeActions(path, node.Actions, handlers)

	// Properties
	var properties Props
	if node.Props != nil || node.ContentRef != nil {
		properties = Props{}
		for k, v := range node.Props {
			properties[k] = v
		}
		if node.ContentRef != nil {
			ref := map[string]any{
				"type":    node.ContentRef.Type,
				"mime":    node.ContentRef.MIME,
				"summary": node.ContentRef.Summary,
			}
			if node.ContentRef.URI != "" {
				ref["uri"] = node.ContentRef.URI
			} else {
				ref["uri"] = fmt.Sprintf("slop://content/%s", path)
			}
			if node.ContentRef.Size != nil {
				ref["size"] = *node.ContentRef.Size
			}
			if node.ContentRef.Preview != "" {
				ref["preview"] = node.ContentRef.Preview
			}
			if node.ContentRef.Encoding != "" {
				ref["encoding"] = node.ContentRef.Encoding
			}
			properties["content_ref"] = ref
		}
	}

	wn := WireNode{
		ID:         id,
		Type:       node.Type,
		Properties: properties,
	}
	if len(children) > 0 {
		wn.Children = children
	}
	if len(affordances) > 0 {
		wn.Affordances = affordances
	}
	if meta != nil {
		wn.Meta = meta
	}

	return wn, handlers
}

func normalizeItem(path string, item Item) (WireNode, map[string]Handler) {
	handlers := map[string]Handler{}
	var children []WireNode

	for childID, childNode := range item.Children {
		childPath := path + "/" + childID
		wn, h := normalizeDescriptor(childPath, childID, childNode)
		children = append(children, wn)
		for k, v := range h {
			handlers[k] = v
		}
	}

	affordances := normalizeActions(path, item.Actions, handlers)
	meta := extractMeta(item.Summary, item.Meta)

	wn := WireNode{
		ID:         item.ID,
		Type:       "item",
		Properties: item.Props,
	}
	if len(children) > 0 {
		wn.Children = children
	}
	if len(affordances) > 0 {
		wn.Affordances = affordances
	}
	if meta != nil {
		wn.Meta = meta
	}

	return wn, handlers
}

func normalizeActions(path string, actions Actions, handlers map[string]Handler) []Affordance {
	if len(actions) == 0 {
		return nil
	}

	var affordances []Affordance
	for name, handler := range actions {
		handlerKey := name
		if path != "" {
			handlerKey = path + "/" + name
		}
		handlers[handlerKey] = handler

		aff := Affordance{Action: name}

		// Extract opts from optsHandler
		if oh, ok := handler.(*optsHandler); ok {
			aff.Label = oh.opts.Label
			aff.Description = oh.opts.Description
			aff.Dangerous = oh.opts.Dangerous
			aff.Idempotent = oh.opts.Idempotent
			aff.Estimate = oh.opts.Estimate
			if oh.opts.Params != nil {
				aff.Params = normalizeParams(oh.opts.Params)
			}
		}

		affordances = append(affordances, aff)
	}

	return affordances
}

func normalizeParams(params map[string]string) map[string]any {
	properties := map[string]any{}
	var required []string
	for key, typeName := range params {
		properties[key] = map[string]any{"type": typeName}
		required = append(required, key)
	}
	return map[string]any{
		"type":       "object",
		"properties": properties,
		"required":   required,
	}
}

func extractMeta(summary string, meta *Meta) *WireMeta {
	if summary == "" && meta == nil {
		return nil
	}

	wm := &WireMeta{}
	if summary != "" {
		wm.Summary = summary
	}
	if meta != nil {
		if meta.Summary != "" {
			wm.Summary = meta.Summary
		}
		wm.Salience = meta.Salience
		wm.Pinned = meta.Pinned
		wm.Changed = meta.Changed
		wm.Focus = meta.Focus
		wm.Urgency = meta.Urgency
		wm.Reason = meta.Reason
		wm.TotalChildren = meta.TotalChildren
		wm.Window = meta.Window
	}

	return wm
}
