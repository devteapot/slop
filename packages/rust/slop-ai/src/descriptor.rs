//! Normalize developer-friendly JSON descriptors into wire-format `SlopNode`s.
//!
//! Descriptors are `serde_json::Value` dicts with keys like `type`, `props`,
//! `actions`, `items`, `children`. This module converts them into proper
//! `SlopNode` instances and extracts a flat `path/action → handler` map.

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{Map, Value};

use crate::error::Result;
use crate::types::{Affordance, Estimate, NodeMeta, SlopNode};

/// An action handler receives params and returns optional result data.
pub type ActionHandler = Arc<dyn Fn(&Value) -> Result<Option<Value>> + Send + Sync>;

/// Normalize a descriptor `Value` into a `SlopNode` and handler map.
pub fn normalize_descriptor(
    path: &str,
    id: &str,
    descriptor: &Value,
) -> (SlopNode, HashMap<String, ActionHandler>) {
    let mut handlers: HashMap<String, ActionHandler> = HashMap::new();
    let mut children: Vec<SlopNode> = Vec::new();
    let mut meta = extract_meta(descriptor);

    // Windowed collection
    if let Some(window) = descriptor.get("window").and_then(|v| v.as_object()) {
        if let Some(items) = window.get("items").and_then(|v| v.as_array()) {
            for item in items {
                let item_id = item["id"].as_str().unwrap_or("");
                let item_path = if path.is_empty() {
                    item_id.to_string()
                } else {
                    format!("{path}/{item_id}")
                };
                let (node, h) = normalize_item(&item_path, item);
                children.push(node);
                handlers.extend(h);
            }
        }
        if let Some(total) = window.get("total").and_then(|v| v.as_u64()) {
            meta.total_children = Some(total as usize);
        }
        meta.window = Some((
            window.get("offset").and_then(|v| v.as_u64()).unwrap_or(0) as usize,
            children.len(),
        ));
    } else if let Some(items) = descriptor.get("items").and_then(|v| v.as_array()) {
        for item in items {
            let item_id = item["id"].as_str().unwrap_or("");
            let item_path = if path.is_empty() {
                item_id.to_string()
            } else {
                format!("{path}/{item_id}")
            };
            let (node, h) = normalize_item(&item_path, item);
            children.push(node);
            handlers.extend(h);
        }
    }

    // Inline children (recursive)
    if let Some(child_map) = descriptor.get("children").and_then(|v| v.as_object()) {
        for (child_id, child_desc) in child_map {
            let child_path = if path.is_empty() {
                child_id.clone()
            } else {
                format!("{path}/{child_id}")
            };
            let (node, h) = normalize_descriptor(&child_path, child_id, child_desc);
            children.push(node);
            handlers.extend(h);
        }
    }

    // Actions → affordances + handlers
    let affordances = normalize_actions(path, descriptor.get("actions"), &mut handlers);

    // Properties, including content_ref
    let properties = build_properties(path, descriptor);

    let meta_opt = if meta.is_empty() { None } else { Some(meta) };

    let node = SlopNode {
        id: id.to_string(),
        node_type: descriptor["type"].as_str().unwrap_or("group").to_string(),
        properties,
        children: if children.is_empty() { None } else { Some(children) },
        affordances: if affordances.is_empty() { None } else { Some(affordances) },
        meta: meta_opt,
    };

    (node, handlers)
}

fn normalize_item(path: &str, item: &Value) -> (SlopNode, HashMap<String, ActionHandler>) {
    let mut handlers: HashMap<String, ActionHandler> = HashMap::new();
    let mut children: Vec<SlopNode> = Vec::new();

    // Item inline children
    if let Some(child_map) = item.get("children").and_then(|v| v.as_object()) {
        for (child_id, child_desc) in child_map {
            let child_path = format!("{path}/{child_id}");
            let (node, h) = normalize_descriptor(&child_path, child_id, child_desc);
            children.push(node);
            handlers.extend(h);
        }
    }

    let affordances = normalize_actions(path, item.get("actions"), &mut handlers);
    let meta = extract_meta(item);
    let meta_opt = if meta.is_empty() { None } else { Some(meta) };

    let properties = item.get("props").and_then(|v| v.as_object()).cloned();

    let node = SlopNode {
        id: item["id"].as_str().unwrap_or("").to_string(),
        node_type: "item".to_string(),
        properties,
        children: if children.is_empty() { None } else { Some(children) },
        affordances: if affordances.is_empty() { None } else { Some(affordances) },
        meta: meta_opt,
    };

    (node, handlers)
}

fn normalize_actions(
    path: &str,
    actions: Option<&Value>,
    _handlers: &mut HashMap<String, ActionHandler>,
) -> Vec<Affordance> {
    let actions = match actions.and_then(|v| v.as_object()) {
        Some(a) => a,
        None => return Vec::new(),
    };

    let mut affordances = Vec::new();

    for (name, action) in actions {
        let handler_key = if path.is_empty() {
            name.clone()
        } else {
            format!("{path}/{name}")
        };

        // Actions in JSON descriptors are always dict-style (no closures in JSON).
        // Closures are registered separately via server.action().
        // Here we only extract affordance metadata.
        if action.is_object() {
            let obj = action.as_object().unwrap();
            let mut aff = Affordance::new(name.as_str());

            if let Some(label) = obj.get("label").and_then(|v| v.as_str()) {
                aff.label = Some(label.to_string());
            }
            if let Some(desc) = obj.get("description").and_then(|v| v.as_str()) {
                aff.description = Some(desc.to_string());
            }
            if obj.get("dangerous").and_then(|v| v.as_bool()).unwrap_or(false) {
                aff.dangerous = true;
            }
            if obj.get("idempotent").and_then(|v| v.as_bool()).unwrap_or(false) {
                aff.idempotent = true;
            }
            if let Some(est) = obj.get("estimate").and_then(|v| v.as_str()) {
                aff.estimate = match est {
                    "instant" => Some(Estimate::Instant),
                    "fast" => Some(Estimate::Fast),
                    "slow" => Some(Estimate::Slow),
                    "async" => Some(Estimate::Async),
                    _ => None,
                };
            }
            if let Some(params) = obj.get("params") {
                aff.params = Some(normalize_params(params));
            }

            affordances.push(aff);
        } else {
            // Simple action name with no metadata
            affordances.push(Affordance::new(name.as_str()));
        }

        // Note: actual handler closures are registered via SlopServer::action(),
        // not through JSON descriptors. The handler_key is reserved for that.
        let _ = handler_key;
    }

    affordances
}

fn normalize_params(params: &Value) -> Value {
    if let Some(obj) = params.as_object() {
        // Check if it's already a JSON Schema
        if obj.contains_key("type") && obj.get("type").and_then(|v| v.as_str()) == Some("object") {
            return params.clone();
        }

        // Simplified format: {"title": "string"} → JSON Schema
        let mut properties = Map::new();
        let mut required = Vec::new();

        for (key, def) in obj {
            if let Some(type_str) = def.as_str() {
                let mut prop = Map::new();
                prop.insert("type".into(), Value::String(type_str.to_string()));
                properties.insert(key.clone(), Value::Object(prop));
            } else if let Some(def_obj) = def.as_object() {
                let mut prop = Map::new();
                if let Some(t) = def_obj.get("type").and_then(|v| v.as_str()) {
                    prop.insert("type".into(), Value::String(t.to_string()));
                }
                if let Some(d) = def_obj.get("description").and_then(|v| v.as_str()) {
                    prop.insert("description".into(), Value::String(d.to_string()));
                }
                if let Some(e) = def_obj.get("enum") {
                    prop.insert("enum".into(), e.clone());
                }
                properties.insert(key.clone(), Value::Object(prop));
            }
            required.push(Value::String(key.clone()));
        }

        let mut schema = Map::new();
        schema.insert("type".into(), Value::String("object".into()));
        schema.insert("properties".into(), Value::Object(properties));
        schema.insert("required".into(), Value::Array(required));
        Value::Object(schema)
    } else {
        params.clone()
    }
}

fn extract_meta(descriptor: &Value) -> NodeMeta {
    let mut meta = NodeMeta::new();

    if let Some(summary) = descriptor.get("summary").and_then(|v| v.as_str()) {
        meta.summary = Some(summary.to_string());
    }

    if let Some(meta_obj) = descriptor.get("meta").and_then(|v| v.as_object()) {
        if let Some(v) = meta_obj.get("summary").and_then(|v| v.as_str()) {
            meta.summary = Some(v.to_string());
        }
        if let Some(v) = meta_obj.get("salience").and_then(|v| v.as_f64()) {
            meta.salience = Some(v);
        }
        if let Some(v) = meta_obj.get("pinned").and_then(|v| v.as_bool()) {
            meta.pinned = Some(v);
        }
        if let Some(v) = meta_obj.get("changed").and_then(|v| v.as_bool()) {
            meta.changed = Some(v);
        }
        if let Some(v) = meta_obj.get("focus").and_then(|v| v.as_bool()) {
            meta.focus = Some(v);
        }
        if let Some(v) = meta_obj.get("urgency").and_then(|v| v.as_str()) {
            meta.urgency = serde_json::from_value(Value::String(v.to_string())).ok();
        }
        if let Some(v) = meta_obj.get("reason").and_then(|v| v.as_str()) {
            meta.reason = Some(v.to_string());
        }
        if let Some(v) = meta_obj.get("total_children").and_then(|v| v.as_u64()) {
            meta.total_children = Some(v as usize);
        }
    }

    meta
}

fn build_properties(path: &str, descriptor: &Value) -> Option<Map<String, Value>> {
    let props = descriptor.get("props").and_then(|v| v.as_object());
    let content_ref = descriptor.get("content_ref");

    match (props, content_ref) {
        (None, None) => None,
        (Some(p), None) => Some(p.clone()),
        (props, Some(cr)) => {
            let mut result = props.cloned().unwrap_or_default();
            let mut ref_val = cr.clone();
            if let Some(obj) = ref_val.as_object_mut() {
                if !obj.contains_key("uri") {
                    obj.insert("uri".into(), Value::String(format!("slop://content/{path}")));
                }
            }
            result.insert("content_ref".into(), ref_val);
            Some(result)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_simple_descriptor() {
        let desc = json!({"type": "group", "props": {"count": 5}});
        let (node, handlers) = normalize_descriptor("inbox", "inbox", &desc);
        assert_eq!(node.id, "inbox");
        assert_eq!(node.node_type, "group");
        assert_eq!(node.properties.unwrap()["count"], 5);
        assert!(handlers.is_empty());
    }

    #[test]
    fn test_items_become_children() {
        let desc = json!({
            "type": "collection",
            "items": [
                {"id": "t1", "props": {"title": "Buy milk"}},
                {"id": "t2", "props": {"title": "Write code"}},
            ]
        });
        let (node, _) = normalize_descriptor("todos", "todos", &desc);
        let children = node.children.unwrap();
        assert_eq!(children.len(), 2);
        assert_eq!(children[0].id, "t1");
        assert_eq!(children[0].node_type, "item");
        assert_eq!(children[1].id, "t2");
    }

    #[test]
    fn test_action_metadata() {
        let desc = json!({
            "type": "group",
            "actions": {
                "delete": {"dangerous": true, "label": "Delete", "estimate": "fast"},
                "open": {}
            }
        });
        let (node, _) = normalize_descriptor("x", "x", &desc);
        let affordances = node.affordances.unwrap();
        assert_eq!(affordances.len(), 2);

        let delete = affordances.iter().find(|a| a.action == "delete").unwrap();
        assert!(delete.dangerous);
        assert_eq!(delete.label.as_deref(), Some("Delete"));
        assert_eq!(delete.estimate, Some(Estimate::Fast));
    }

    #[test]
    fn test_content_ref() {
        let desc = json!({
            "type": "document",
            "props": {"title": "main.rs"},
            "content_ref": {
                "type": "text",
                "mime": "text/rust",
                "summary": "Rust source file"
            }
        });
        let (node, _) = normalize_descriptor("editor/file", "file", &desc);
        let props = node.properties.unwrap();
        let cr = props["content_ref"].as_object().unwrap();
        assert_eq!(cr["type"], "text");
        assert_eq!(cr["uri"], "slop://content/editor/file");
    }

    #[test]
    fn test_meta_extraction() {
        let desc = json!({
            "type": "status",
            "summary": "All good",
            "meta": {"salience": 0.9, "urgency": "high"}
        });
        let (node, _) = normalize_descriptor("x", "x", &desc);
        let meta = node.meta.unwrap();
        assert_eq!(meta.summary.as_deref(), Some("All good"));
        assert_eq!(meta.salience, Some(0.9));
    }

    #[test]
    fn test_windowed_collection() {
        let desc = json!({
            "type": "collection",
            "window": {
                "items": [
                    {"id": "m1", "props": {"subject": "Hello"}},
                    {"id": "m2", "props": {"subject": "World"}},
                ],
                "total": 100,
                "offset": 0
            }
        });
        let (node, _) = normalize_descriptor("inbox", "inbox", &desc);
        let children = node.children.unwrap();
        assert_eq!(children.len(), 2);
        let meta = node.meta.unwrap();
        assert_eq!(meta.total_children, Some(100));
        assert_eq!(meta.window, Some((0, 2)));
    }

    #[test]
    fn test_inline_children() {
        let desc = json!({
            "type": "root",
            "children": {
                "sidebar": {"type": "group", "props": {"label": "Sidebar"}},
                "main": {"type": "view"}
            }
        });
        let (node, _) = normalize_descriptor("app", "app", &desc);
        let children = node.children.unwrap();
        assert_eq!(children.len(), 2);
        let ids: Vec<&str> = children.iter().map(|c| c.id.as_str()).collect();
        assert!(ids.contains(&"sidebar"));
        assert!(ids.contains(&"main"));
    }

    #[test]
    fn test_normalize_params_simplified() {
        let params = json!({"title": "string", "count": "number"});
        let schema = normalize_params(&params);
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["properties"]["title"]["type"], "string");
        assert_eq!(schema["properties"]["count"]["type"], "number");
    }
}
