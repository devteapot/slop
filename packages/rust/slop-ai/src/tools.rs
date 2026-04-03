//! LLM tool integration — convert SLOP affordances into LLM-consumable tool
//! definitions and format trees for context injection.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::types::SlopNode;

/// An LLM tool definition (OpenAI-compatible format).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmTool {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: LlmFunction,
}

/// The function part of an LLM tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmFunction {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

/// Resolved path and action for a tool name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolResolution {
    pub path: String,
    pub action: String,
}

/// A set of LLM tools with a resolver to map short names back to full paths.
#[derive(Debug, Clone)]
pub struct ToolSet {
    pub tools: Vec<LlmTool>,
    resolve_map: HashMap<String, ToolResolution>,
}

impl ToolSet {
    /// Resolve a tool name back to its path and action for invoke messages.
    pub fn resolve(&self, tool_name: &str) -> Option<&ToolResolution> {
        self.resolve_map.get(tool_name)
    }
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}

struct Entry {
    short_name: String,
    path: String,
    action: String,
    ancestors: Vec<String>,
    label: Option<String>,
    description: Option<String>,
    dangerous: bool,
    params: Option<Value>,
}

/// Walk a node tree and collect all affordances as LLM tools.
///
/// Tool names use short `{nodeId}__{action}` format. Collisions are
/// disambiguated by prepending parent IDs.
pub fn affordances_to_tools(node: &SlopNode, path: &str) -> ToolSet {
    let mut entries = Vec::new();
    collect(node, path, &[], &mut entries);

    let name_map = disambiguate(&entries);

    let mut tools = Vec::new();
    let mut resolve_map = HashMap::new();

    for (i, entry) in entries.iter().enumerate() {
        let tool_name = &name_map[i];
        let p = if entry.path.is_empty() { "/" } else { &entry.path };

        resolve_map.insert(
            tool_name.clone(),
            ToolResolution { path: p.to_string(), action: entry.action.clone() },
        );

        let label = entry.label.as_deref().unwrap_or(&entry.action);
        let mut desc = match &entry.description {
            Some(d) => format!("{label}: {d}"),
            None => label.to_string(),
        };
        desc.push_str(&format!(" (on {p})"));
        if entry.dangerous {
            desc.push_str(" [DANGEROUS - confirm first]");
        }

        let parameters = entry.params.clone()
            .unwrap_or_else(|| json!({"type": "object", "properties": {}}));

        tools.push(LlmTool {
            tool_type: "function".into(),
            function: LlmFunction {
                name: tool_name.clone(),
                description: desc,
                parameters,
            },
        });
    }

    ToolSet { tools, resolve_map }
}

fn collect(node: &SlopNode, path: &str, ancestors: &[String], out: &mut Vec<Entry>) {
    let safe_id = sanitize(&node.id);
    if let Some(affs) = &node.affordances {
        for aff in affs {
            let safe_action = sanitize(&aff.action);
            let p = if path.is_empty() { "/".to_string() } else { path.to_string() };
            out.push(Entry {
                short_name: format!("{safe_id}__{safe_action}"),
                path: p,
                action: aff.action.clone(),
                ancestors: ancestors.iter().map(|a| sanitize(a)).collect(),
                label: aff.label.clone(),
                description: aff.description.clone(),
                dangerous: aff.dangerous,
                params: aff.params.clone(),
            });
        }
    }
    if let Some(children) = &node.children {
        let mut new_ancestors = ancestors.to_vec();
        new_ancestors.push(node.id.clone());
        for child in children {
            let child_path = format!("{}/{}", path, child.id);
            collect(child, &child_path, &new_ancestors, out);
        }
    }
}

fn disambiguate(entries: &[Entry]) -> Vec<String> {
    let mut result = vec![String::new(); entries.len()];

    // Group by short name
    let mut groups: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, e) in entries.iter().enumerate() {
        groups.entry(&e.short_name).or_default().push(i);
    }

    for (short_name, indices) in &groups {
        if indices.len() == 1 {
            result[indices[0]] = short_name.to_string();
            continue;
        }
        // Collision — prepend ancestors until unique
        for &idx in indices {
            let entry = &entries[idx];
            let mut name = short_name.to_string();
            for i in (0..entry.ancestors.len()).rev() {
                name = format!("{}__{name}", entry.ancestors[i]);
                let mut unique = true;
                let depth = entry.ancestors.len() - 1 - i;
                for &other in indices {
                    if other == idx { continue; }
                    let oe = &entries[other];
                    let mut o_name = short_name.to_string();
                    for j in (0..oe.ancestors.len()).rev().take(depth + 1) {
                        o_name = format!("{}__{o_name}", oe.ancestors[j]);
                    }
                    if o_name == name {
                        unique = false;
                        break;
                    }
                }
                if unique { break; }
            }
            result[idx] = name;
        }
    }

    result
}

/// Format a node tree as an indented text block suitable for LLM context.
pub fn format_tree(node: &SlopNode, indent: usize) -> String {
    let mut out = String::new();
    write_node(node, indent, &mut out);
    out
}

fn write_node(node: &SlopNode, indent: usize, out: &mut String) {
    let pad = "  ".repeat(indent);

    // Header: [type] nodeId: label
    let display_name = node.properties.as_ref().and_then(|p| {
        p.get("label")
            .or_else(|| p.get("title"))
            .and_then(|v| v.as_str())
    });
    let header = match display_name {
        Some(name) if name != node.id => format!("{}: {}", node.id, name),
        _ => node.id.clone(),
    };
    out.push_str(&format!("{pad}[{}] {header}", node.node_type));

    // Extra properties (skip label and title)
    if let Some(props) = &node.properties {
        let pairs: Vec<String> = props
            .iter()
            .filter(|(k, _)| k.as_str() != "label" && k.as_str() != "title")
            .map(|(k, v)| format!("{k}={v}"))
            .collect();
        if !pairs.is_empty() {
            out.push_str(&format!(" ({})", pairs.join(", ")));
        }
    }

    // Meta: flags, summary, salience
    if let Some(meta) = &node.meta {
        let mut flags = Vec::new();
        if meta.pinned == Some(true) {
            flags.push("pinned");
        }
        if meta.focus == Some(true) {
            flags.push("focus");
        }
        if meta.changed == Some(true) {
            flags.push("changed");
        }
        if let Some(ref u) = meta.urgency {
            flags.push(match u {
                crate::types::Urgency::Critical => "CRITICAL",
                crate::types::Urgency::High => "HIGH",
                crate::types::Urgency::Medium => "medium",
                crate::types::Urgency::Low => "low",
                crate::types::Urgency::None => "",
            });
        }
        let flags: Vec<&str> = flags.into_iter().filter(|f| !f.is_empty()).collect();
        if !flags.is_empty() {
            out.push_str(&format!(" [{}]", flags.join(", ")));
        }
        if let Some(ref summary) = meta.summary {
            out.push_str(&format!("  \u{2014} \"{summary}\""));
        }
        if let Some(salience) = meta.salience {
            out.push_str(&format!("  salience={}", (salience * 100.0).round() / 100.0));
        }
    }

    // Affordances inline
    if let Some(affs) = &node.affordances {
        if !affs.is_empty() {
            let acts: Vec<String> = affs
                .iter()
                .map(|aff| {
                    let mut s = aff.action.clone();
                    if let Some(ref params) = aff.params {
                        if let Some(props) = params.get("properties").and_then(|p| p.as_object())
                        {
                            let param_strs: Vec<String> = props
                                .iter()
                                .map(|(k, v)| {
                                    let typ =
                                        v.get("type").and_then(|t| t.as_str()).unwrap_or("?");
                                    format!("{k}: {typ}")
                                })
                                .collect();
                            if !param_strs.is_empty() {
                                s.push_str(&format!("({})", param_strs.join(", ")));
                            }
                        }
                    }
                    s
                })
                .collect();
            out.push_str(&format!("  actions: {{{}}}", acts.join(", ")));
        }
    }

    out.push('\n');

    // Windowing indicators
    if let Some(meta) = &node.meta {
        let child_count = node.children.as_ref().map_or(0, |c| c.len());
        if let Some(total) = meta.total_children {
            if total > child_count {
                if meta.window.is_some() {
                    out.push_str(&format!(
                        "{pad}  (showing {} of {})\n",
                        child_count, total
                    ));
                } else if child_count == 0 {
                    let noun = if total == 1 { "child" } else { "children" };
                    out.push_str(&format!("{pad}  ({} {} not loaded)\n", total, noun));
                }
            }
        }
    }

    if let Some(children) = &node.children {
        for child in children {
            write_node(child, indent + 1, out);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{NodeMeta, SlopNode, Urgency};
    use serde_json::json;

    fn sample_tree() -> SlopNode {
        serde_json::from_value(json!({
            "id": "app",
            "type": "root",
            "properties": {"label": "My App"},
            "children": [
                {
                    "id": "counter",
                    "type": "status",
                    "properties": {"count": 5},
                    "affordances": [
                        {"action": "increment", "label": "Add one", "description": "Increment the counter"},
                        {"action": "reset", "dangerous": true}
                    ]
                }
            ]
        }))
        .unwrap()
    }

    /// Canonical test tree matching spec/core/state-tree.md "Consumer display format".
    fn canonical_tree() -> SlopNode {
        serde_json::from_value(json!({
            "id": "store",
            "type": "root",
            "properties": {"label": "Pet Store"},
            "meta": {"salience": 0.9},
            "affordances": [
                {"action": "search", "params": {"type": "object", "properties": {"query": {"type": "string"}}}}
            ],
            "children": [
                {
                    "id": "catalog",
                    "type": "collection",
                    "properties": {"label": "Catalog", "count": 142},
                    "meta": {"total_children": 142, "window": [0, 25], "summary": "142 products, 12 on sale"},
                    "children": [
                        {
                            "id": "prod-1",
                            "type": "item",
                            "properties": {"label": "Rubber Duck", "price": 4.99, "in_stock": true},
                            "affordances": [
                                {"action": "add_to_cart", "params": {"type": "object", "properties": {"quantity": {"type": "number"}}}},
                                {"action": "view"}
                            ]
                        }
                    ]
                },
                {
                    "id": "cart",
                    "type": "collection",
                    "properties": {"label": "Cart"},
                    "meta": {"total_children": 3, "summary": "3 items, $24.97"}
                }
            ]
        }))
        .unwrap()
    }

    #[test]
    fn test_short_tool_names() {
        let tree = sample_tree();
        let ts = affordances_to_tools(&tree, "/app");
        assert_eq!(ts.tools.len(), 2);
        assert_eq!(ts.tools[0].tool_type, "function");
        assert_eq!(ts.tools[0].function.name, "counter__increment");
        assert_eq!(ts.tools[1].function.name, "counter__reset");
    }

    #[test]
    fn test_resolve() {
        let tree = sample_tree();
        let ts = affordances_to_tools(&tree, "/app");
        let r = ts.resolve("counter__increment").unwrap();
        assert_eq!(r.path, "/app/counter");
        assert_eq!(r.action, "increment");
    }

    #[test]
    fn test_disambiguate_collisions() {
        let tree: SlopNode = serde_json::from_value(json!({
            "id": "root", "type": "root",
            "children": [
                { "id": "board-1", "type": "view", "children": [
                    { "id": "backlog", "type": "collection", "affordances": [{"action": "reorder"}] }
                ]},
                { "id": "board-2", "type": "view", "children": [
                    { "id": "backlog", "type": "collection", "affordances": [{"action": "reorder"}] }
                ]}
            ]
        })).unwrap();
        let ts = affordances_to_tools(&tree, "");
        assert_eq!(ts.tools.len(), 2);
        let names: Vec<&str> = ts.tools.iter().map(|t| t.function.name.as_str()).collect();
        assert!(names.contains(&"board_1__backlog__reorder"));
        assert!(names.contains(&"board_2__backlog__reorder"));

        let r1 = ts.resolve("board_1__backlog__reorder").unwrap();
        assert_eq!(r1.path, "/board-1/backlog");
        let r2 = ts.resolve("board_2__backlog__reorder").unwrap();
        assert_eq!(r2.path, "/board-2/backlog");
    }

    #[test]
    fn test_format_tree_header_id_and_label() {
        let text = format_tree(&canonical_tree(), 0);
        assert!(text.contains("[root] store: Pet Store"), "missing root header:\n{text}");
        assert!(text.contains("[collection] catalog: Catalog"), "missing catalog header:\n{text}");
        assert!(text.contains("[item] prod-1: Rubber Duck"), "missing prod header:\n{text}");
    }

    #[test]
    fn test_format_tree_header_id_only_when_no_label() {
        let node = SlopNode::new("status", "status");
        let text = format_tree(&node, 0);
        assert!(text.contains("[status] status"), "missing id-only header:\n{text}");
    }

    #[test]
    fn test_format_tree_extra_props_exclude_label() {
        let text = format_tree(&canonical_tree(), 0);
        assert!(text.contains("count=142"), "missing count prop:\n{text}");
        assert!(!text.contains("label="), "label= should be excluded:\n{text}");
    }

    #[test]
    fn test_format_tree_meta_summary_quoted() {
        let text = format_tree(&canonical_tree(), 0);
        assert!(text.contains("\"142 products, 12 on sale\""), "missing catalog summary:\n{text}");
        assert!(text.contains("\"3 items, $24.97\""), "missing cart summary:\n{text}");
    }

    #[test]
    fn test_format_tree_meta_salience() {
        let text = format_tree(&canonical_tree(), 0);
        assert!(text.contains("salience=0.9"), "missing salience:\n{text}");
    }

    #[test]
    fn test_format_tree_affordances_inline_with_params() {
        let text = format_tree(&canonical_tree(), 0);
        assert!(text.contains("actions: {search(query: string)}"), "missing search:\n{text}");
        assert!(text.contains("add_to_cart(quantity: number)"), "missing add_to_cart:\n{text}");
        assert!(text.contains("view}"), "missing view:\n{text}");
    }

    #[test]
    fn test_format_tree_windowed_collection() {
        let text = format_tree(&canonical_tree(), 0);
        assert!(text.contains("(showing 1 of 142)"), "missing windowed indicator:\n{text}");
    }

    #[test]
    fn test_format_tree_lazy_collection() {
        let text = format_tree(&canonical_tree(), 0);
        assert!(text.contains("(3 children not loaded)"), "missing lazy indicator:\n{text}");
    }

    #[test]
    fn test_format_tree_with_meta_flags() {
        let mut tree = sample_tree();
        tree.meta = Some(NodeMeta {
            summary: Some("Root node".into()),
            focus: Some(true),
            urgency: Some(Urgency::High),
            ..NodeMeta::default()
        });
        let text = format_tree(&tree, 0);
        assert!(text.contains("[focus, HIGH]"), "missing flags:\n{text}");
        assert!(text.contains("\"Root node\""), "missing summary:\n{text}");
    }

    #[test]
    fn test_format_tree_indentation() {
        let text = format_tree(&canonical_tree(), 0);
        let lines: Vec<&str> = text.lines().collect();
        assert!(lines[0].starts_with("[root]"), "root should be at indent 0");
        let catalog = lines.iter().find(|l| l.contains("catalog")).unwrap();
        assert!(catalog.starts_with("  [collection]"), "catalog should be at indent 1");
        let prod = lines.iter().find(|l| l.contains("prod-1")).unwrap();
        assert!(prod.starts_with("    [item]"), "prod-1 should be at indent 2");
    }

    #[test]
    fn test_no_affordances() {
        let tree = SlopNode::new("empty", "group");
        let ts = affordances_to_tools(&tree, "/empty");
        assert!(ts.tools.is_empty());
    }
}
