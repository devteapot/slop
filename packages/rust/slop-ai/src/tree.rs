//! Assemble a hierarchical SLOP tree from flat path-based registrations.
//!
//! Paths encode hierarchy: `"inbox/messages"` becomes a child of `"inbox"`.
//! Missing ancestors are created as synthetic placeholder nodes.

use std::collections::HashMap;

use serde_json::Value;

use crate::descriptor::{normalize_descriptor, ActionHandler};
use crate::types::SlopNode;

/// Build a hierarchical `SlopNode` tree from flat registrations.
///
/// Returns `(tree, handlers)` where `handlers` maps `"path/action"` to callables.
pub fn assemble_tree(
    registrations: &HashMap<String, Value>,
    root_id: &str,
    root_name: &str,
) -> (SlopNode, HashMap<String, ActionHandler>) {
    let mut all_handlers: HashMap<String, ActionHandler> = HashMap::new();
    let mut nodes_by_path: HashMap<String, SlopNode> = HashMap::new();

    // Sort by depth (shallowest first), then alphabetically
    let mut sorted_paths: Vec<&String> = registrations.keys().collect();
    sorted_paths.sort_by(|a, b| {
        let depth_a = a.matches('/').count();
        let depth_b = b.matches('/').count();
        depth_a.cmp(&depth_b).then_with(|| a.cmp(b))
    });

    // Normalize each registration
    for path in &sorted_paths {
        let descriptor = &registrations[*path];
        let id = path.rsplit('/').next().unwrap_or(path);
        let (node, handlers) = normalize_descriptor(path, id, descriptor);
        nodes_by_path.insert((*path).clone(), node);
        all_handlers.extend(handlers);
    }

    // Root
    let mut root = SlopNode::root(root_id, root_name);

    // Attach each node to its parent
    for path in &sorted_paths {
        let node = nodes_by_path.remove(*path).unwrap();
        let parent_path = parent_path(path);

        if parent_path.is_empty() {
            add_child(&mut root, node);
        } else {
            let parent = ensure_node(&parent_path, &mut nodes_by_path, &mut root);
            add_child(parent, node);
        }
    }

    (root, all_handlers)
}

fn parent_path(path: &str) -> String {
    match path.rfind('/') {
        Some(idx) => path[..idx].to_string(),
        None => String::new(),
    }
}

fn ensure_node<'a>(
    path: &str,
    nodes_by_path: &'a mut HashMap<String, SlopNode>,
    root: &'a mut SlopNode,
) -> &'a mut SlopNode {
    // If already exists in nodes_by_path, it's been placed in the tree already.
    // We need to find it in the tree structure.
    // For simplicity, we create synthetic nodes and attach them.
    if !nodes_by_path.contains_key(path) {
        let id = path.rsplit('/').next().unwrap_or(path);
        let synthetic = SlopNode {
            id: id.to_string(),
            node_type: "group".to_string(),
            properties: None,
            children: Some(Vec::new()),
            affordances: None,
            meta: None,
            content_ref: None,
        };
        nodes_by_path.insert(path.to_string(), synthetic);

        let pp = parent_path(path);
        if pp.is_empty() {
            let node = nodes_by_path.remove(path).unwrap();
            add_child(root, node);
        } else {
            ensure_node(&pp, nodes_by_path, root);
            let node = nodes_by_path.remove(path).unwrap();
            // Find the parent in the tree and add
            if let Some(parent) = find_node_mut(root, &pp) {
                add_child(parent, node);
            }
        }
    } else {
        // Node exists in map but needs to be placed
        let node = nodes_by_path.remove(path).unwrap();
        let pp = parent_path(path);
        if pp.is_empty() {
            add_child(root, node);
        } else {
            ensure_node(&pp, nodes_by_path, root);
            if let Some(parent) = find_node_mut(root, &pp) {
                add_child(parent, node);
            }
        }
    }

    // Now find it in the tree
    find_node_mut(root, path).expect("node should exist after ensure")
}

fn find_node_mut<'a>(root: &'a mut SlopNode, path: &str) -> Option<&'a mut SlopNode> {
    let segments: Vec<&str> = path.split('/').collect();
    let children = root.children.as_mut()?;

    let mut current_children = children;
    for (i, seg) in segments.iter().enumerate() {
        let idx = current_children.iter().position(|c| c.id == *seg)?;
        if i == segments.len() - 1 {
            return Some(&mut current_children[idx]);
        }
        let node = &mut current_children[idx];
        current_children = node.children.as_mut()?;
    }
    None
}

fn add_child(parent: &mut SlopNode, child: SlopNode) {
    let children = parent.children.get_or_insert_with(Vec::new);

    if let Some(idx) = children.iter().position(|c| c.id == child.id) {
        let existing = &children[idx];
        // If existing was a synthetic placeholder, transfer its children
        if existing.node_type == "group" && existing.properties.is_none() {
            let mut new_child = child;
            if let Some(existing_children) = &existing.children {
                if !existing_children.is_empty() {
                    if new_child.children.is_none() {
                        new_child.children = Some(existing_children.clone());
                    } else if let Some(new_children) = &mut new_child.children {
                        let new_ids: std::collections::HashSet<String> =
                            new_children.iter().map(|c| c.id.clone()).collect();
                        for ec in existing_children {
                            if !new_ids.contains(&ec.id) {
                                new_children.push(ec.clone());
                            }
                        }
                    }
                }
            }
            children[idx] = new_child;
        } else {
            children[idx] = child;
        }
    } else {
        children.push(child);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn regs(pairs: Vec<(&str, Value)>) -> HashMap<String, Value> {
        pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect()
    }

    #[test]
    fn test_single_registration() {
        let (tree, _) = assemble_tree(
            &regs(vec![("inbox", json!({"type": "group", "props": {"label": "Inbox"}}))]),
            "app",
            "My App",
        );
        assert_eq!(tree.id, "app");
        assert_eq!(tree.node_type, "root");
        let children = tree.children.unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].id, "inbox");
    }

    #[test]
    fn test_nested_paths() {
        let (tree, _) = assemble_tree(
            &regs(vec![
                ("inbox", json!({"type": "group"})),
                ("inbox/messages", json!({"type": "collection", "props": {"count": 5}})),
            ]),
            "app",
            "App",
        );
        let inbox = &tree.children.as_ref().unwrap()[0];
        assert_eq!(inbox.id, "inbox");
        let messages = &inbox.children.as_ref().unwrap()[0];
        assert_eq!(messages.id, "messages");
        assert_eq!(messages.properties.as_ref().unwrap()["count"], 5);
    }

    #[test]
    fn test_synthetic_placeholders() {
        let (tree, _) = assemble_tree(
            &regs(vec![("a/b/c", json!({"type": "item", "props": {"x": 1}}))]),
            "root",
            "Root",
        );
        let a = &tree.children.as_ref().unwrap()[0];
        assert_eq!(a.id, "a");
        assert_eq!(a.node_type, "group");
        assert!(a.properties.is_none()); // synthetic

        let b = &a.children.as_ref().unwrap()[0];
        assert_eq!(b.id, "b");

        let c = &b.children.as_ref().unwrap()[0];
        assert_eq!(c.id, "c");
        assert_eq!(c.node_type, "item");
    }

    #[test]
    fn test_multiple_top_level() {
        let (tree, _) = assemble_tree(
            &regs(vec![
                ("inbox", json!({"type": "group"})),
                ("settings", json!({"type": "group"})),
                ("profile", json!({"type": "group"})),
            ]),
            "app",
            "App",
        );
        assert_eq!(tree.children.as_ref().unwrap().len(), 3);
    }

    #[test]
    fn test_deep_nesting() {
        let (tree, _) = assemble_tree(
            &regs(vec![
                ("a", json!({"type": "group"})),
                ("a/b", json!({"type": "group"})),
                ("a/b/c", json!({"type": "group"})),
                ("a/b/c/d", json!({"type": "item", "props": {"deep": true}})),
            ]),
            "root",
            "Root",
        );
        let a = &tree.children.as_ref().unwrap()[0];
        let b = &a.children.as_ref().unwrap()[0];
        let c = &b.children.as_ref().unwrap()[0];
        let d = &c.children.as_ref().unwrap()[0];
        assert_eq!(d.id, "d");
        assert_eq!(d.properties.as_ref().unwrap()["deep"], true);
    }
}
