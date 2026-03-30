//! Tree scaling utilities: depth truncation, node-budget compaction,
//! salience filtering, and subtree extraction.

use crate::types::{NodeMeta, SlopNode};

/// Options for preparing a tree for output to a consumer.
#[derive(Debug, Clone, Default)]
pub struct OutputTreeOptions {
    /// Maximum depth to resolve. Nodes beyond this become stubs with summaries.
    pub max_depth: Option<usize>,
    /// Maximum total nodes. Lowest-salience subtrees are collapsed first.
    pub max_nodes: Option<usize>,
    /// Minimum salience threshold. Nodes below this are excluded.
    pub min_salience: Option<f64>,
    /// Only include nodes of these types.
    pub types: Option<Vec<String>>,
}

/// Prepare a tree for output by applying filter → truncate → compact.
pub fn prepare_tree(root: &SlopNode, options: &OutputTreeOptions) -> SlopNode {
    let mut tree = root.clone();
    if options.min_salience.is_some() || options.types.is_some() {
        tree = filter_tree(&tree, options.min_salience, options.types.as_deref());
    }
    if let Some(max_depth) = options.max_depth {
        tree = truncate_tree(&tree, max_depth as i32);
    }
    if let Some(max_nodes) = options.max_nodes {
        tree = auto_compact(&tree, max_nodes);
    }
    tree
}

/// Extract a subtree by slash-separated node ID path (e.g. "/inbox/msg-42").
pub fn get_subtree<'a>(root: &'a SlopNode, path: &str) -> Option<&'a SlopNode> {
    if path.is_empty() || path == "/" {
        return Some(root);
    }
    let segments: Vec<&str> = path.trim_start_matches('/').split('/').filter(|s| !s.is_empty()).collect();
    let mut current = root;
    for seg in segments {
        let children = current.children.as_ref()?;
        current = children.iter().find(|c| c.id == seg)?;
    }
    Some(current)
}

/// Collapse nodes beyond depth to stubs with `meta.total_children`.
pub fn truncate_tree(node: &SlopNode, depth: i32) -> SlopNode {
    if depth <= 0 {
        if let Some(children) = &node.children {
            if !children.is_empty() {
                let mut meta = node.meta.clone().unwrap_or_default();
                meta.total_children = Some(children.len());
                return SlopNode {
                    id: node.id.clone(),
                    node_type: node.node_type.clone(),
                    properties: node.properties.clone(),
                    children: None,
                    affordances: None,
                    meta: Some(meta),
                    content_ref: node.content_ref.clone(),
                };
            }
        }
    }
    match &node.children {
        None => node.clone(),
        Some(children) => {
            let mut out = node.clone();
            out.children = Some(
                children.iter().map(|c| truncate_tree(c, depth - 1)).collect(),
            );
            out
        }
    }
}

/// Collapse lowest-salience subtrees to fit within a node budget.
/// Preserves root children and pinned nodes.
pub fn auto_compact(root: &SlopNode, max_nodes: usize) -> SlopNode {
    let total = count_nodes(root);
    if total <= max_nodes {
        return root.clone();
    }

    let mut candidates = Vec::new();
    if let Some(children) = &root.children {
        for (i, child) in children.iter().enumerate() {
            collect_candidates(child, &[i], &mut candidates, false);
        }
    }

    candidates.sort_by(|a, b| a.score.partial_cmp(&b.score).unwrap_or(std::cmp::Ordering::Equal));

    let mut tree = root.clone();
    let mut node_count = total;

    for candidate in &candidates {
        if node_count <= max_nodes {
            break;
        }
        let saved = collapse_at_path(&mut tree, &candidate.path);
        node_count -= saved;
    }

    tree
}

/// Filter a tree by salience threshold and/or node types.
/// The root node is never filtered.
pub fn filter_tree(node: &SlopNode, min_salience: Option<f64>, types: Option<&[String]>) -> SlopNode {
    let children = match &node.children {
        None => return node.clone(),
        Some(c) => c,
    };

    let filtered: Vec<SlopNode> = children
        .iter()
        .filter(|child| {
            if let Some(ms) = min_salience {
                let s = child.meta.as_ref().and_then(|m| m.salience).unwrap_or(0.5);
                if s < ms {
                    return false;
                }
            }
            if let Some(t) = types {
                if !t.iter().any(|ty| ty == &child.node_type) {
                    return false;
                }
            }
            true
        })
        .map(|child| filter_tree(child, min_salience, types))
        .collect();

    let mut out = node.clone();
    out.children = if filtered.is_empty() { None } else { Some(filtered) };
    out
}

/// Count total nodes in a tree.
pub fn count_nodes(node: &SlopNode) -> usize {
    1 + node
        .children
        .as_ref()
        .map(|c| c.iter().map(count_nodes).sum())
        .unwrap_or(0)
}

// --- Internal helpers ---

struct CompactCandidate {
    path: Vec<usize>,
    score: f64,
    #[allow(dead_code)]
    child_count: usize,
}

fn collect_candidates(
    node: &SlopNode,
    path: &[usize],
    candidates: &mut Vec<CompactCandidate>,
    is_root_child: bool,
) {
    let children = match &node.children {
        None => return,
        Some(c) => c,
    };
    for (i, child) in children.iter().enumerate() {
        let mut child_path = path.to_vec();
        child_path.push(i);

        let pinned = child.meta.as_ref().and_then(|m| m.pinned).unwrap_or(false);
        let has_children = child.children.as_ref().map_or(false, |c| !c.is_empty());

        if has_children && !is_root_child && !pinned {
            let child_count = count_nodes(child) - 1;
            let salience = child.meta.as_ref().and_then(|m| m.salience).unwrap_or(0.5);
            let depth = child_path.len() as f64;
            let score = salience - depth * 0.01 - child_count as f64 * 0.001;
            candidates.push(CompactCandidate {
                path: child_path.clone(),
                score,
                child_count,
            });
        }

        collect_candidates(child, &child_path, candidates, false);
    }
}

fn collapse_at_path(tree: &mut SlopNode, path: &[usize]) -> usize {
    let mut node = tree;
    for &idx in &path[..path.len() - 1] {
        let children = match &mut node.children {
            Some(c) if idx < c.len() => c,
            _ => return 0,
        };
        node = &mut children[idx];
    }

    let last_idx = path[path.len() - 1];
    let children = match &mut node.children {
        Some(c) if last_idx < c.len() => c,
        _ => return 0,
    };

    let target = &children[last_idx];
    let saved = count_nodes(target) - 1;
    let tc = target.children.as_ref().map_or(0, |c| c.len());

    let mut meta = target.meta.clone().unwrap_or_default();
    meta.total_children = Some(tc);
    if meta.summary.is_none() {
        meta.summary = Some(format!("{} children", tc));
    }

    children[last_idx] = SlopNode {
        id: target.id.clone(),
        node_type: target.node_type.clone(),
        properties: target.properties.clone(),
        children: None,
        affordances: target.affordances.clone(),
        meta: Some(meta),
        content_ref: target.content_ref.clone(),
    };

    saved
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::NodeMeta;

    fn make_node(id: &str, node_type: &str) -> SlopNode {
        SlopNode::new(id, node_type)
    }

    fn make_tree() -> SlopNode {
        let mut root = make_node("root", "root");
        let mut inbox = make_node("inbox", "view");
        inbox.meta = Some(NodeMeta { salience: Some(0.8), ..Default::default() });
        let msg1 = make_node("msg-1", "item");
        let msg2 = make_node("msg-2", "item");
        inbox.children = Some(vec![msg1, msg2]);

        let mut settings = make_node("settings", "view");
        settings.meta = Some(NodeMeta { salience: Some(0.1), ..Default::default() });
        let mut general = make_node("general", "group");
        general.children = Some(vec![make_node("theme", "item")]);
        settings.children = Some(vec![general]);

        root.children = Some(vec![inbox, settings]);
        root
    }

    #[test]
    fn test_count_nodes() {
        let tree = make_tree();
        assert_eq!(count_nodes(&tree), 7);
    }

    #[test]
    fn test_get_subtree() {
        let tree = make_tree();
        let sub = get_subtree(&tree, "/inbox").unwrap();
        assert_eq!(sub.id, "inbox");
        let msg = get_subtree(&tree, "/inbox/msg-1").unwrap();
        assert_eq!(msg.id, "msg-1");
        assert!(get_subtree(&tree, "/nonexistent").is_none());
    }

    #[test]
    fn test_truncate_tree() {
        let tree = make_tree();
        let truncated = truncate_tree(&tree, 1);
        assert!(truncated.children.is_some());
        let children = truncated.children.unwrap();
        // inbox children should be collapsed
        assert!(children[0].children.is_none());
        assert_eq!(children[0].meta.as_ref().unwrap().total_children, Some(2));
    }

    #[test]
    fn test_filter_tree() {
        let tree = make_tree();
        let filtered = filter_tree(&tree, Some(0.5), None);
        let children = filtered.children.unwrap();
        assert_eq!(children.len(), 1); // only inbox (salience 0.8)
        assert_eq!(children[0].id, "inbox");
    }

    #[test]
    fn test_auto_compact() {
        let tree = make_tree();
        // 7 nodes total, compact to 6 — settings/general subtree (2 nodes) collapses to 1
        let compacted = auto_compact(&tree, 6);
        assert!(count_nodes(&compacted) <= 6);
        // settings should still exist but general should be a stub
        let settings = get_subtree(&compacted, "/settings").unwrap();
        let general = &settings.children.as_ref().unwrap()[0];
        assert!(general.children.is_none());
        assert!(general.meta.as_ref().unwrap().total_children.is_some());
    }

    #[test]
    fn test_prepare_tree() {
        let tree = make_tree();
        let opts = OutputTreeOptions {
            max_depth: Some(1),
            min_salience: Some(0.5),
            ..Default::default()
        };
        let prepared = prepare_tree(&tree, &opts);
        let children = prepared.children.unwrap();
        assert_eq!(children.len(), 1); // filtered to inbox
        assert!(children[0].children.is_none()); // truncated at depth 1
    }
}
