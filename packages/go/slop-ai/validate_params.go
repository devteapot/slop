package slop

import (
	"encoding/json"
	"fmt"
)

// ValidateParams checks `params` against the affordance's JSON Schema and
// returns a human-readable error string on failure (empty string on success).
// Mirrors the TS/Python implementations so the `invalid_params` error code is
// reliable across SDKs.
//
// Supported schema subset:
//   - type: object|string|number|integer|boolean|array|null
//   - required (for objects)
//   - properties (for objects)
//   - items (for arrays)
//   - enum
func ValidateParams(schema map[string]any, params any) string {
	if len(schema) == 0 {
		return ""
	}
	return validateParamsImpl(schema, params, "params")
}

func validateParamsImpl(schema map[string]any, value any, path string) string {
	if raw, ok := schema["enum"]; ok {
		if list, ok := raw.([]any); ok {
			matched := false
			for _, opt := range list {
				if deepEqual(opt, value) {
					matched = true
					break
				}
			}
			if !matched {
				b, _ := json.Marshal(list)
				return fmt.Sprintf("%s must be one of %s", path, string(b))
			}
		}
	}

	t, _ := schema["type"].(string)
	switch t {
	case "object":
		obj, ok := value.(map[string]any)
		if !ok {
			return fmt.Sprintf("%s must be an object", path)
		}
		if req, ok := schema["required"].([]any); ok {
			for _, r := range req {
				key, _ := r.(string)
				if key == "" {
					continue
				}
				if _, present := obj[key]; !present {
					return fmt.Sprintf("%s.%s is required", path, key)
				}
			}
		}
		if props, ok := schema["properties"].(map[string]any); ok {
			for key, v := range obj {
				if ps, ok := props[key].(map[string]any); ok {
					if err := validateParamsImpl(ps, v, path+"."+key); err != "" {
						return err
					}
				}
			}
		}
		return ""
	case "array":
		arr, ok := value.([]any)
		if !ok {
			return fmt.Sprintf("%s must be an array", path)
		}
		if items, ok := schema["items"].(map[string]any); ok {
			for i, item := range arr {
				if err := validateParamsImpl(items, item, fmt.Sprintf("%s[%d]", path, i)); err != "" {
					return err
				}
			}
		}
		return ""
	case "string":
		if _, ok := value.(string); ok {
			return ""
		}
		return fmt.Sprintf("%s must be a string", path)
	case "number":
		switch value.(type) {
		case float64, float32, int, int64, int32:
			return ""
		}
		return fmt.Sprintf("%s must be a number", path)
	case "integer":
		switch v := value.(type) {
		case int, int32, int64:
			return ""
		case float64:
			if v == float64(int64(v)) {
				return ""
			}
		}
		return fmt.Sprintf("%s must be an integer", path)
	case "boolean":
		if _, ok := value.(bool); ok {
			return ""
		}
		return fmt.Sprintf("%s must be a boolean", path)
	case "null":
		if value == nil {
			return ""
		}
		return fmt.Sprintf("%s must be null", path)
	}
	return ""
}

func deepEqual(a, b any) bool {
	if a == nil && b == nil {
		return true
	}
	aj, errA := json.Marshal(a)
	bj, errB := json.Marshal(b)
	if errA != nil || errB != nil {
		return false
	}
	return string(aj) == string(bj)
}
