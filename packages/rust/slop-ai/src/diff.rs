//! Recursive diff of two SLOP trees producing JSON Patch operations.
//!
//! Paths in generated ops use node IDs for children segments (not array indices),
//! matching the SLOP patch convention.

use crate::types::{PatchOp, PatchOpKind, SlopNode};

/// Recursively diff two trees and return patch operations.
pub fn diff_nodes(old: &SlopNode, new: &SlopNode, base_path: &str) -> Vec<PatchOp> {
    let mut ops = Vec::new();

    // --- properties ---
    diff_properties(old, new, base_path, &mut ops);

    // --- affordances (replace entire list if changed) ---
    let old_aff = old.affordances.as_ref().map(|a| serde_json::to_value(a).unwrap());
    let new_aff = new.affordances.as_ref().map(|a| serde_json::to_value(a).unwrap());
    if old_aff != new_aff {
        match (&old_aff, &new_aff) {
            (_, Some(val)) => ops.push(PatchOp {
                op: if old_aff.is_some() { PatchOpKind::Replace } else { PatchOpKind::Add },
                path: format!("{base_path}/affordances"),
                value: Some(val.clone()),
            }),
            (Some(_), None) => ops.push(PatchOp {
                op: PatchOpKind::Remove,
                path: format!("{base_path}/affordances"),
                value: None,
            }),
            (None, None) => {}
        }
    }

    // --- meta (replace entire object if changed) ---
    let old_meta = old.meta.as_ref().map(|m| serde_json::to_value(m).unwrap());
    let new_meta = new.meta.as_ref().map(|m| serde_json::to_value(m).unwrap());
    if old_meta != new_meta {
        match (&old_meta, &new_meta) {
            (_, Some(val)) => ops.push(PatchOp {
                op: if old_meta.is_some() { PatchOpKind::Replace } else { PatchOpKind::Add },
                path: format!("{base_path}/meta"),
                value: Some(val.clone()),
            }),
            (Some(_), None) => ops.push(PatchOp {
                op: PatchOpKind::Remove,
                path: format!("{base_path}/meta"),
                value: None,
            }),
            (None, None) => {}
        }
    }

    // --- children ---
    let old_children = old.children.as_deref().unwrap_or(&[]);
    let new_children = new.children.as_deref().unwrap_or(&[]);

    let old_ids: std::collections::HashMap<&str, &SlopNode> =
        old_children.iter().map(|c| (c.id.as_str(), c)).collect();
    let new_ids: std::collections::HashMap<&str, &SlopNode> =
        new_children.iter().map(|c| (c.id.as_str(), c)).collect();

    // Removed children
    for child in old_children {
        if !new_ids.contains_key(child.id.as_str()) {
            ops.push(PatchOp {
                op: PatchOpKind::Remove,
                path: format!("{base_path}/{}", child.id),
                value: None,
            });
        }
    }

    // Added children
    for child in new_children {
        if !old_ids.contains_key(child.id.as_str()) {
            ops.push(PatchOp {
                op: PatchOpKind::Add,
                path: format!("{base_path}/{}", child.id),
                value: Some(serde_json::to_value(child).unwrap()),
            });
        }
    }

    // Recursively diff shared children
    for child in new_children {
        if let Some(old_child) = old_ids.get(child.id.as_str()) {
            let child_path = format!("{base_path}/{}", child.id);
            ops.extend(diff_nodes(old_child, child, &child_path));
        }
    }

    ops
}

fn diff_properties(old: &SlopNode, new: &SlopNode, base_path: &str, ops: &mut Vec<PatchOp>) {
    let empty_map = serde_json::Map::new();
    let old_props = old.properties.as_ref().unwrap_or(&empty_map);
    let new_props = new.properties.as_ref().unwrap_or(&empty_map);

    let mut all_keys: Vec<&String> = old_props.keys().chain(new_props.keys()).collect();
    all_keys.sort();
    all_keys.dedup();

    for key in all_keys {
        let old_val = old_props.get(key);
        let new_val = new_props.get(key);
        match (old_val, new_val) {
            (None, Some(v)) => ops.push(PatchOp {
                op: PatchOpKind::Add,
                path: format!("{base_path}/properties/{key}"),
                value: Some(v.clone()),
            }),
            (Some(_), None) => ops.push(PatchOp {
                op: PatchOpKind::Remove,
                path: format!("{base_path}/properties/{key}"),
                value: None,
            }),
            (Some(old_v), Some(new_v)) if old_v != new_v => ops.push(PatchOp {
                op: PatchOpKind::Replace,
                path: format!("{base_path}/properties/{key}"),
                value: Some(new_v.clone()),
            }),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Affordance, NodeMeta};
    use serde_json::{json, Value};

    fn node(id: &str) -> SlopNode {
        SlopNode::new(id, "group")
    }

    fn node_with_props(id: &str, props: serde_json::Map<String, Value>) -> SlopNode {
        SlopNode {
            properties: Some(props),
            ..SlopNode::new(id, "group")
        }
    }

    fn props(pairs: Vec<(&str, Value)>) -> serde_json::Map<String, Value> {
        pairs
            .into_iter()
            .map(|(k, v): (&str, Value)| (k.to_string(), v))
            .collect()
    }

    #[test]
    fn test_no_changes() {
        let n = node_with_props("x", props(vec![("a", json!(1))]));
        let ops = diff_nodes(&n, &n, "");
        assert!(ops.is_empty());
    }

    #[test]
    fn test_property_added() {
        let old = node_with_props("x", props(vec![("a", json!(1))]));
        let new = node_with_props("x", props(vec![("a", json!(1)), ("b", json!(2))]));
        let ops = diff_nodes(&old, &new, "");
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].op, PatchOpKind::Add);
        assert_eq!(ops[0].path, "/properties/b");
    }

    #[test]
    fn test_property_removed() {
        let old = node_with_props("x", props(vec![("a", json!(1)), ("b", json!(2))]));
        let new = node_with_props("x", props(vec![("a", json!(1))]));
        let ops = diff_nodes(&old, &new, "");
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].op, PatchOpKind::Remove);
        assert_eq!(ops[0].path, "/properties/b");
    }

    #[test]
    fn test_property_changed() {
        let old = node_with_props("x", props(vec![("a", json!(1))]));
        let new = node_with_props("x", props(vec![("a", json!(2))]));
        let ops = diff_nodes(&old, &new, "");
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].op, PatchOpKind::Replace);
        assert_eq!(ops[0].value, Some(json!(2)));
    }

    #[test]
    fn test_child_added() {
        let old = SlopNode { children: Some(vec![]), ..node("x") };
        let child = node("c1");
        let new = SlopNode { children: Some(vec![child]), ..node("x") };
        let ops = diff_nodes(&old, &new, "");
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].op, PatchOpKind::Add);
        assert_eq!(ops[0].path, "/c1");
    }

    #[test]
    fn test_child_removed() {
        let child = node("c1");
        let old = SlopNode { children: Some(vec![child]), ..node("x") };
        let new = SlopNode { children: Some(vec![]), ..node("x") };
        let ops = diff_nodes(&old, &new, "");
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].op, PatchOpKind::Remove);
        assert_eq!(ops[0].path, "/c1");
    }

    #[test]
    fn test_nested_diff() {
        let old = SlopNode {
            children: Some(vec![SlopNode {
                children: Some(vec![node_with_props("b", props(vec![("x", json!(1))]))]),
                ..node("a")
            }]),
            ..node("root")
        };
        let new = SlopNode {
            children: Some(vec![SlopNode {
                children: Some(vec![node_with_props("b", props(vec![("x", json!(2))]))]),
                ..node("a")
            }]),
            ..node("root")
        };
        let ops = diff_nodes(&old, &new, "");
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].path, "/a/b/properties/x");
        assert_eq!(ops[0].value, Some(json!(2)));
    }

    #[test]
    fn test_meta_changed() {
        let old = SlopNode {
            meta: Some(NodeMeta { salience: Some(0.5), ..NodeMeta::new() }),
            ..node("x")
        };
        let new = SlopNode {
            meta: Some(NodeMeta { salience: Some(0.9), ..NodeMeta::new() }),
            ..node("x")
        };
        let ops = diff_nodes(&old, &new, "");
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].op, PatchOpKind::Replace);
        assert_eq!(ops[0].path, "/meta");
    }

    #[test]
    fn test_affordances_changed() {
        let old = SlopNode {
            affordances: Some(vec![Affordance::new("open")]),
            ..node("x")
        };
        let new = SlopNode {
            affordances: Some(vec![Affordance::new("open"), Affordance::new("delete")]),
            ..node("x")
        };
        let ops = diff_nodes(&old, &new, "");
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].op, PatchOpKind::Replace);
        assert_eq!(ops[0].path, "/affordances");
    }
}
