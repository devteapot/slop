use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// A single node in the SLOP state tree (wire format).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SlopNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub properties: Option<Map<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<SlopNode>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affordances: Option<Vec<Affordance>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<NodeMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_ref: Option<ContentRef>,
}

impl SlopNode {
    pub fn new(id: impl Into<String>, node_type: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            node_type: node_type.into(),
            properties: None,
            children: None,
            affordances: None,
            meta: None,
            content_ref: None,
        }
    }

    pub fn root(id: impl Into<String>, name: impl Into<String>) -> Self {
        let mut props = Map::new();
        props.insert("label".into(), Value::String(name.into()));
        Self {
            id: id.into(),
            node_type: "root".into(),
            properties: Some(props),
            children: Some(Vec::new()),
            affordances: None,
            meta: None,
            content_ref: None,
        }
    }
}

/// An action available on a node.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Affordance {
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub dangerous: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub idempotent: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimate: Option<Estimate>,
}

impl Affordance {
    pub fn new(action: impl Into<String>) -> Self {
        Self {
            action: action.into(),
            label: None,
            description: None,
            params: None,
            dangerous: false,
            idempotent: false,
            estimate: None,
        }
    }
}

/// Expected duration of an action.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Estimate {
    Instant,
    Fast,
    Slow,
    Async,
}

/// Attention and structural metadata for a node.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NodeMeta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub salience: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub urgency: Option<Urgency>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_children: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window: Option<(usize, usize)>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated: Option<String>,
}

impl NodeMeta {
    pub fn new() -> Self {
        Self {
            summary: None,
            salience: None,
            pinned: None,
            changed: None,
            focus: None,
            urgency: None,
            reason: None,
            total_children: None,
            window: None,
            created: None,
            updated: None,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.summary.is_none()
            && self.salience.is_none()
            && self.pinned.is_none()
            && self.changed.is_none()
            && self.focus.is_none()
            && self.urgency.is_none()
            && self.reason.is_none()
            && self.total_children.is_none()
            && self.window.is_none()
            && self.created.is_none()
            && self.updated.is_none()
    }
}

impl Default for NodeMeta {
    fn default() -> Self {
        Self::new()
    }
}

/// Time-sensitivity signal.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Urgency {
    None,
    Low,
    Medium,
    High,
    Critical,
}

/// A single JSON Patch (RFC 6902) operation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PatchOp {
    pub op: PatchOpKind,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PatchOpKind {
    Add,
    Remove,
    Replace,
}

/// Reference to content that can be fetched on demand.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContentRef {
    #[serde(rename = "type")]
    pub content_type: ContentType,
    pub mime: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encoding: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ContentType {
    Text,
    Binary,
    Stream,
}

fn is_false(v: &bool) -> bool {
    !v
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_slop_node_roundtrip() {
        let node = SlopNode::root("app", "My App");
        let json = serde_json::to_value(&node).unwrap();
        assert_eq!(json["id"], "app");
        assert_eq!(json["type"], "root");
        assert_eq!(json["properties"]["label"], "My App");

        let back: SlopNode = serde_json::from_value(json).unwrap();
        assert_eq!(back.id, "app");
        assert_eq!(back.node_type, "root");
    }

    #[test]
    fn test_affordance_skip_false_fields() {
        let aff = Affordance::new("toggle");
        let json = serde_json::to_value(&aff).unwrap();
        assert!(json.get("dangerous").is_none());
        assert!(json.get("idempotent").is_none());
    }

    #[test]
    fn test_affordance_with_dangerous() {
        let json = json!({"action": "delete", "dangerous": true});
        let aff: Affordance = serde_json::from_value(json).unwrap();
        assert!(aff.dangerous);
        assert!(!aff.idempotent);
    }

    #[test]
    fn test_estimate_serialization() {
        let est = Estimate::Async;
        let json = serde_json::to_value(&est).unwrap();
        assert_eq!(json, "async");
    }

    #[test]
    fn test_patch_op() {
        let op = PatchOp {
            op: PatchOpKind::Replace,
            path: "/properties/count".into(),
            value: Some(json!(42)),
        };
        let json = serde_json::to_value(&op).unwrap();
        assert_eq!(json["op"], "replace");
        assert_eq!(json["path"], "/properties/count");
        assert_eq!(json["value"], 42);
    }
}
