//! LLM tool integration — convert SLOP affordances into LLM-consumable tool
//! definitions and format trees for context injection.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::types::{Affordance, SlopNode};

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

/// Walk a node tree and collect all affordances as LLM tool definitions.
///
/// `path` is the SLOP path prefix for this node (e.g. `"/app"`).
pub fn affordances_to_tools(node: &SlopNode, path: &str) -> Vec<LlmTool> {
    let mut tools = Vec::new();
    collect_tools(node, path, &mut tools);
    tools
}

fn collect_tools(node: &SlopNode, path: &str, out: &mut Vec<LlmTool>) {
    if let Some(affs) = &node.affordances {
        for aff in affs {
            out.push(affordance_to_tool(aff, path));
        }
    }
    if let Some(children) = &node.children {
        for child in children {
            let child_path = format!("{}/{}", path, child.id);
            collect_tools(child, &child_path, out);
        }
    }
}

fn affordance_to_tool(aff: &Affordance, path: &str) -> LlmTool {
    let name = encode_tool(path, &aff.action);

    let description = aff
        .description
        .clone()
        .or_else(|| aff.label.clone())
        .unwrap_or_else(|| format!("{} at {}", aff.action, path));

    let parameters = aff
        .params
        .clone()
        .unwrap_or_else(|| json!({"type": "object", "properties": {}}));

    LlmTool {
        tool_type: "function".into(),
        function: LlmFunction {
            name,
            description,
            parameters,
        },
    }
}

/// Encode a SLOP path and action into a tool function name.
///
/// Uses `__` as separator with `invoke` prefix, matching the cross-language convention.
/// Example: `("/app/counter", "increment")` -> `"invoke__app__counter__increment"`.
pub fn encode_tool(path: &str, action: &str) -> String {
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let mut parts = vec!["invoke"];
    parts.extend(segments);
    parts.push(action);
    parts.join("__")
}

/// Decode a tool name back into `(path, action)`.
///
/// Returns the path with a leading `/`.
pub fn decode_tool(name: &str) -> (String, String) {
    let parts: Vec<&str> = name.split("__").collect();
    if parts.is_empty() {
        return ("/".into(), String::new());
    }
    let action = parts[parts.len() - 1].to_string();
    // Skip "invoke" prefix (index 0) and action (last)
    let start = if parts[0] == "invoke" { 1 } else { 0 };
    let path_segments = &parts[start..parts.len() - 1];
    let path = if path_segments.is_empty() {
        "/".into()
    } else {
        format!("/{}", path_segments.join("/"))
    };
    (path, action)
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
    use crate::types::{Affordance, NodeMeta, SlopNode, Urgency};
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
    fn test_encode_decode() {
        let encoded = encode_tool("/app/counter", "increment");
        assert_eq!(encoded, "invoke__app__counter__increment");

        let (path, action) = decode_tool(&encoded);
        assert_eq!(path, "/app/counter");
        assert_eq!(action, "increment");
    }

    #[test]
    fn test_encode_root() {
        let encoded = encode_tool("/", "refresh");
        assert_eq!(encoded, "invoke__refresh");

        let (path, action) = decode_tool(&encoded);
        assert_eq!(path, "/");
        assert_eq!(action, "refresh");
    }

    #[test]
    fn test_affordances_to_tools() {
        let tree = sample_tree();
        let tools = affordances_to_tools(&tree, "/app");
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].tool_type, "function");
        assert_eq!(tools[0].function.name, "invoke__app__counter__increment");
        assert_eq!(tools[0].function.description, "Increment the counter");
        assert_eq!(tools[1].function.name, "invoke__app__counter__reset");
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
        let tools = affordances_to_tools(&tree, "/empty");
        assert!(tools.is_empty());
    }
}
