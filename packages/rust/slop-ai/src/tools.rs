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
    let pad = " ".repeat(indent);
    out.push_str(&format!("{pad}[{}] ({})", node.id, node.node_type));

    if let Some(props) = &node.properties {
        if !props.is_empty() {
            let pairs: Vec<String> = props
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect();
            out.push_str(&format!(" {{{}}}", pairs.join(", ")));
        }
    }

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
            out.push_str(&format!(" — {summary}"));
        }
    }

    out.push('\n');

    if let Some(affs) = &node.affordances {
        for aff in affs {
            out.push_str(&format!("{pad}  -> {}", aff.action));
            if let Some(ref label) = aff.label {
                out.push_str(&format!(" ({label})"));
            }
            out.push('\n');
        }
    }

    if let Some(children) = &node.children {
        for child in children {
            write_node(child, indent + 2, out);
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
    fn test_format_tree_basic() {
        let tree = sample_tree();
        let text = format_tree(&tree, 0);
        assert!(text.contains("[app] (root)"));
        assert!(text.contains("[counter] (status)"));
        assert!(text.contains("-> increment (Add one)"));
        assert!(text.contains("count=5"));
    }

    #[test]
    fn test_format_tree_with_meta() {
        let mut tree = sample_tree();
        tree.meta = Some(NodeMeta {
            summary: Some("Root node".into()),
            focus: Some(true),
            urgency: Some(Urgency::High),
            ..NodeMeta::default()
        });
        let text = format_tree(&tree, 0);
        assert!(text.contains("[focus, HIGH]"));
        assert!(text.contains("Root node"));
    }

    #[test]
    fn test_no_affordances() {
        let tree = SlopNode::new("empty", "group");
        let ts = affordances_to_tools(&tree, "/empty");
        assert!(ts.tools.is_empty());
    }
}
