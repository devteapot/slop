//! Minimal JSON Schema validator for affordance invoke params.
//!
//! Mirrors the TS/Python/Go implementations so the `invalid_params` error
//! code is reliable across SDKs. Supported subset:
//!
//! * `type`: object | string | number | integer | boolean | array | null
//! * `required` (for objects)
//! * `properties` (for objects)
//! * `items` (for arrays)
//! * `enum`

use serde_json::Value;

/// Returns `None` on success or a human-readable error message.
pub fn validate_params(schema: Option<&Value>, params: &Value) -> Option<String> {
    let Some(schema) = schema else { return None };
    if !schema.is_object() {
        return None;
    }
    validate(schema, params, "params")
}

fn validate(schema: &Value, value: &Value, path: &str) -> Option<String> {
    if let Some(options) = schema.get("enum").and_then(|v| v.as_array()) {
        if !options.iter().any(|opt| opt == value) {
            return Some(format!(
                "{path} must be one of {}",
                serde_json::to_string(options).unwrap_or_default()
            ));
        }
    }

    match schema.get("type").and_then(|v| v.as_str()) {
        Some("object") => {
            let Some(obj) = value.as_object() else {
                return Some(format!("{path} must be an object"));
            };
            if let Some(required) = schema.get("required").and_then(|v| v.as_array()) {
                for key in required {
                    if let Some(k) = key.as_str() {
                        if !obj.contains_key(k) {
                            return Some(format!("{path}.{k} is required"));
                        }
                    }
                }
            }
            if let Some(props) = schema.get("properties").and_then(|v| v.as_object()) {
                for (key, v) in obj {
                    if let Some(prop_schema) = props.get(key) {
                        let sub_path = format!("{path}.{key}");
                        if let Some(err) = validate(prop_schema, v, &sub_path) {
                            return Some(err);
                        }
                    }
                }
            }
            None
        }
        Some("array") => {
            let Some(arr) = value.as_array() else {
                return Some(format!("{path} must be an array"));
            };
            if let Some(items) = schema.get("items") {
                for (i, item) in arr.iter().enumerate() {
                    let sub_path = format!("{path}[{i}]");
                    if let Some(err) = validate(items, item, &sub_path) {
                        return Some(err);
                    }
                }
            }
            None
        }
        Some("string") => {
            if value.is_string() {
                None
            } else {
                Some(format!("{path} must be a string"))
            }
        }
        Some("number") => {
            if value.is_number() {
                None
            } else {
                Some(format!("{path} must be a number"))
            }
        }
        Some("integer") => {
            if value.is_i64() || value.is_u64() {
                None
            } else if let Some(f) = value.as_f64() {
                if f.fract() == 0.0 {
                    None
                } else {
                    Some(format!("{path} must be an integer"))
                }
            } else {
                Some(format!("{path} must be an integer"))
            }
        }
        Some("boolean") => {
            if value.is_boolean() {
                None
            } else {
                Some(format!("{path} must be a boolean"))
            }
        }
        Some("null") => {
            if value.is_null() {
                None
            } else {
                Some(format!("{path} must be null"))
            }
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn empty_schema_ok() {
        assert_eq!(validate_params(None, &json!({"x": 1})), None);
        assert_eq!(
            validate_params(Some(&json!({"type": "object"})), &json!({})),
            None
        );
    }

    #[test]
    fn required_missing() {
        let schema = json!({"type": "object", "required": ["body"]});
        let err = validate_params(Some(&schema), &json!({}));
        assert!(err.unwrap().contains("body"));
    }

    #[test]
    fn wrong_type() {
        let schema = json!({"type": "object", "properties": {"count": {"type": "integer"}}});
        let err = validate_params(Some(&schema), &json!({"count": "x"}));
        assert!(err.unwrap().contains("count"));
    }

    #[test]
    fn array_items() {
        let schema = json!({
            "type": "object",
            "properties": {"tags": {"type": "array", "items": {"type": "string"}}}
        });
        assert_eq!(
            validate_params(Some(&schema), &json!({"tags": ["a", "b"]})),
            None
        );
        let err = validate_params(Some(&schema), &json!({"tags": ["a", 2]})).unwrap();
        assert!(err.contains("tags[1]"));
    }
}
