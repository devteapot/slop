//! Local state mirror — applies snapshots and JSON patch ops to maintain a
//! client-side copy of the SLOP state tree.

use serde_json::{Map, Value};

use crate::types::{NodeMeta, PatchOp, PatchOpKind, SlopNode};

/// Maintains a local copy of a SLOP provider's state tree.
///
/// Constructed from an initial snapshot and updated incrementally via
/// [`apply_patch`](StateMirror::apply_patch).
pub struct StateMirror {
    tree: SlopNode,
    version: u64,
}

impl StateMirror {
    /// Create a mirror from an initial snapshot.
    pub fn new(tree: SlopNode, version: u64) -> Self {
        Self { tree, version }
    }

    /// Apply a batch of patch operations and bump the version.
    pub fn apply_patch(&mut self, ops: &[PatchOp], version: u64) {
        for op in ops {
            let segments = parse_path(&op.path);
            apply_one(&mut self.tree, &segments, &op.op, op.value.as_ref());
        }
        self.version = version;
    }

    /// Current tree.
    pub fn tree(&self) -> &SlopNode {
        &self.tree
    }

    /// Current version.
    pub fn version(&self) -> u64 {
        self.version
    }
}

// ---------------------------------------------------------------------------
// Internal path parsing & application
// ---------------------------------------------------------------------------

fn parse_path(path: &str) -> Vec<String> {
    let trimmed = path.strip_prefix('/').unwrap_or(path);
    if trimmed.is_empty() {
        return Vec::new();
    }
    trimmed.split('/').map(String::from).collect()
}

/// Recursively navigate the tree and apply a single patch op.
fn apply_one(node: &mut SlopNode, segments: &[String], op: &PatchOpKind, value: Option<&Value>) {
    if segments.is_empty() {
        // Replace the entire node.
        if let PatchOpKind::Replace = op {
            if let Some(val) = value {
                if let Ok(new_node) = serde_json::from_value::<SlopNode>(val.clone()) {
                    *node = new_node;
                }
            }
        }
        return;
    }

    let (first, rest) = (&segments[0], &segments[1..]);

    match first.as_str() {
        "properties" => apply_in_properties(node, rest, op, value),
        "children" => apply_in_children(node, rest, op, value),
        "meta" => apply_in_meta(node, rest, op, value),
        "affordances" => apply_in_affordances(node, rest, op, value),
        // Top-level scalar fields (id, type).
        "id" => {
            if let PatchOpKind::Replace = op {
                if let Some(Value::String(s)) = value {
                    node.id = s.clone();
                }
            }
        }
        "type" => {
            if let PatchOpKind::Replace = op {
                if let Some(Value::String(s)) = value {
                    node.node_type = s.clone();
                }
            }
        }
        _ => {}
    }
}

// -- properties --

fn apply_in_properties(
    node: &mut SlopNode,
    segments: &[String],
    op: &PatchOpKind,
    value: Option<&Value>,
) {
    if segments.is_empty() {
        // Operating on properties as a whole.
        match op {
            PatchOpKind::Replace | PatchOpKind::Add => {
                if let Some(val) = value {
                    if let Some(obj) = val.as_object() {
                        node.properties = Some(obj.clone());
                    }
                }
            }
            PatchOpKind::Remove => {
                node.properties = None;
            }
        }
        return;
    }

    let key = &segments[0];
    let props = node.properties.get_or_insert_with(Map::new);

    if segments.len() == 1 {
        match op {
            PatchOpKind::Add | PatchOpKind::Replace => {
                if let Some(val) = value {
                    props.insert(key.clone(), val.clone());
                }
            }
            PatchOpKind::Remove => {
                props.remove(key.as_str());
            }
        }
    } else {
        // Nested path inside a property value — operate on the JSON value.
        if let Some(v) = props.get_mut(key.as_str()) {
            apply_in_value(v, &segments[1..], op, value);
        }
    }
}

// -- children --

fn apply_in_children(
    node: &mut SlopNode,
    segments: &[String],
    op: &PatchOpKind,
    value: Option<&Value>,
) {
    if segments.is_empty() {
        match op {
            PatchOpKind::Replace | PatchOpKind::Add => {
                if let Some(val) = value {
                    if let Ok(children) = serde_json::from_value::<Vec<SlopNode>>(val.clone()) {
                        node.children = Some(children);
                    }
                }
            }
            PatchOpKind::Remove => {
                node.children = None;
            }
        }
        return;
    }

    let child_id = &segments[0];
    let children = node.children.get_or_insert_with(Vec::new);

    if segments.len() == 1 {
        match op {
            PatchOpKind::Add => {
                if let Some(val) = value {
                    if let Ok(child) = serde_json::from_value::<SlopNode>(val.clone()) {
                        children.push(child);
                    }
                }
            }
            PatchOpKind::Replace => {
                if let Some(val) = value {
                    if let Ok(child) = serde_json::from_value::<SlopNode>(val.clone()) {
                        if let Some(pos) = children.iter().position(|c| c.id == *child_id) {
                            children[pos] = child;
                        } else {
                            children.push(child);
                        }
                    }
                }
            }
            PatchOpKind::Remove => {
                children.retain(|c| c.id != *child_id);
            }
        }
    } else {
        // Recurse into the child node.
        if let Some(child) = children.iter_mut().find(|c| c.id == *child_id) {
            apply_one(child, &segments[1..], op, value);
        }
    }
}

// -- meta --

fn apply_in_meta(
    node: &mut SlopNode,
    segments: &[String],
    op: &PatchOpKind,
    value: Option<&Value>,
) {
    if segments.is_empty() {
        match op {
            PatchOpKind::Replace | PatchOpKind::Add => {
                if let Some(val) = value {
                    if let Ok(m) = serde_json::from_value::<NodeMeta>(val.clone()) {
                        node.meta = Some(m);
                    }
                }
            }
            PatchOpKind::Remove => {
                node.meta = None;
            }
        }
        return;
    }

    let field = &segments[0];
    let meta = node.meta.get_or_insert_with(NodeMeta::default);

    // For single-segment paths, set/remove the field directly.
    if segments.len() == 1 {
        match op {
            PatchOpKind::Remove => {
                set_meta_field(meta, field, None);
            }
            PatchOpKind::Add | PatchOpKind::Replace => {
                set_meta_field(meta, field, value);
            }
        }
    }
    // Deeper meta paths are uncommon; ignore for now.
}

fn set_meta_field(meta: &mut NodeMeta, field: &str, value: Option<&Value>) {
    match field {
        "summary" => {
            meta.summary = value.and_then(|v| v.as_str()).map(String::from);
        }
        "salience" => {
            meta.salience = value.and_then(|v| v.as_f64());
        }
        "pinned" => {
            meta.pinned = value.and_then(|v| v.as_bool());
        }
        "changed" => {
            meta.changed = value.and_then(|v| v.as_bool());
        }
        "focus" => {
            meta.focus = value.and_then(|v| v.as_bool());
        }
        "urgency" => {
            meta.urgency = value.and_then(|v| serde_json::from_value(v.clone()).ok());
        }
        "reason" => {
            meta.reason = value.and_then(|v| v.as_str()).map(String::from);
        }
        "total_children" => {
            meta.total_children = value.and_then(|v| v.as_u64()).map(|n| n as usize);
        }
        "window" => {
            meta.window = value.and_then(|v| {
                let arr = v.as_array()?;
                Some((arr.first()?.as_u64()? as usize, arr.get(1)?.as_u64()? as usize))
            });
        }
        "created" => {
            meta.created = value.and_then(|v| v.as_str()).map(String::from);
        }
        "updated" => {
            meta.updated = value.and_then(|v| v.as_str()).map(String::from);
        }
        _ => {}
    }
}

// -- affordances --

fn apply_in_affordances(
    node: &mut SlopNode,
    segments: &[String],
    op: &PatchOpKind,
    value: Option<&Value>,
) {
    if segments.is_empty() {
        match op {
            PatchOpKind::Replace | PatchOpKind::Add => {
                if let Some(val) = value {
                    if let Ok(affs) =
                        serde_json::from_value::<Vec<crate::types::Affordance>>(val.clone())
                    {
                        node.affordances = Some(affs);
                    }
                }
            }
            PatchOpKind::Remove => {
                node.affordances = None;
            }
        }
        return;
    }

    // Index-based access for affordances.
    if let Ok(idx) = segments[0].parse::<usize>() {
        let affs = node.affordances.get_or_insert_with(Vec::new);
        if segments.len() == 1 {
            match op {
                PatchOpKind::Add => {
                    if let Some(val) = value {
                        if let Ok(aff) =
                            serde_json::from_value::<crate::types::Affordance>(val.clone())
                        {
                            if idx <= affs.len() {
                                affs.insert(idx, aff);
                            } else {
                                affs.push(aff);
                            }
                        }
                    }
                }
                PatchOpKind::Replace => {
                    if let Some(val) = value {
                        if let Ok(aff) =
                            serde_json::from_value::<crate::types::Affordance>(val.clone())
                        {
                            if idx < affs.len() {
                                affs[idx] = aff;
                            }
                        }
                    }
                }
                PatchOpKind::Remove => {
                    if idx < affs.len() {
                        affs.remove(idx);
                    }
                }
            }
        }
    }
}

// -- generic JSON value navigation --

fn apply_in_value(
    target: &mut Value,
    segments: &[String],
    op: &PatchOpKind,
    value: Option<&Value>,
) {
    if segments.is_empty() {
        if let PatchOpKind::Replace | PatchOpKind::Add = op {
            if let Some(val) = value {
                *target = val.clone();
            }
        }
        return;
    }

    let (first, rest) = (&segments[0], &segments[1..]);

    if let Some(obj) = target.as_object_mut() {
        if rest.is_empty() {
            match op {
                PatchOpKind::Add | PatchOpKind::Replace => {
                    if let Some(val) = value {
                        obj.insert(first.clone(), val.clone());
                    }
                }
                PatchOpKind::Remove => {
                    obj.remove(first.as_str());
                }
            }
        } else if let Some(child) = obj.get_mut(first.as_str()) {
            apply_in_value(child, rest, op, value);
        }
    } else if let Some(arr) = target.as_array_mut() {
        if let Ok(idx) = first.parse::<usize>() {
            if rest.is_empty() {
                match op {
                    PatchOpKind::Add => {
                        if let Some(val) = value {
                            if idx <= arr.len() {
                                arr.insert(idx, val.clone());
                            }
                        }
                    }
                    PatchOpKind::Replace => {
                        if let Some(val) = value {
                            if idx < arr.len() {
                                arr[idx] = val.clone();
                            }
                        }
                    }
                    PatchOpKind::Remove => {
                        if idx < arr.len() {
                            arr.remove(idx);
                        }
                    }
                }
            } else if idx < arr.len() {
                apply_in_value(&mut arr[idx], rest, op, value);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{PatchOp, PatchOpKind, SlopNode};
    use serde_json::json;

    fn make_tree() -> SlopNode {
        serde_json::from_value(json!({
            "id": "app",
            "type": "root",
            "properties": {"label": "My App"},
            "children": [
                {
                    "id": "counter",
                    "type": "status",
                    "properties": {"count": 0}
                }
            ]
        }))
        .unwrap()
    }

    #[test]
    fn test_new_and_getters() {
        let tree = make_tree();
        let mirror = StateMirror::new(tree.clone(), 1);
        assert_eq!(mirror.version(), 1);
        assert_eq!(mirror.tree().id, "app");
    }

    #[test]
    fn test_replace_property() {
        let mut mirror = StateMirror::new(make_tree(), 1);
        mirror.apply_patch(
            &[PatchOp {
                op: PatchOpKind::Replace,
                path: "/children/counter/properties/count".into(),
                value: Some(json!(42)),
            }],
            2,
        );
        assert_eq!(mirror.version(), 2);
        let counter = &mirror.tree().children.as_ref().unwrap()[0];
        assert_eq!(counter.properties.as_ref().unwrap()["count"], 42);
    }

    #[test]
    fn test_add_property() {
        let mut mirror = StateMirror::new(make_tree(), 1);
        mirror.apply_patch(
            &[PatchOp {
                op: PatchOpKind::Add,
                path: "/children/counter/properties/label".into(),
                value: Some(json!("Counter")),
            }],
            2,
        );
        let counter = &mirror.tree().children.as_ref().unwrap()[0];
        assert_eq!(counter.properties.as_ref().unwrap()["label"], "Counter");
    }

    #[test]
    fn test_remove_child() {
        let mut mirror = StateMirror::new(make_tree(), 1);
        mirror.apply_patch(
            &[PatchOp {
                op: PatchOpKind::Remove,
                path: "/children/counter".into(),
                value: None,
            }],
            2,
        );
        assert!(mirror.tree().children.as_ref().unwrap().is_empty());
    }

    #[test]
    fn test_add_child() {
        let mut mirror = StateMirror::new(make_tree(), 1);
        mirror.apply_patch(
            &[PatchOp {
                op: PatchOpKind::Add,
                path: "/children/settings".into(),
                value: Some(json!({"id": "settings", "type": "group"})),
            }],
            2,
        );
        let children = mirror.tree().children.as_ref().unwrap();
        assert_eq!(children.len(), 2);
        assert_eq!(children[1].id, "settings");
    }

    #[test]
    fn test_set_meta_field() {
        let mut mirror = StateMirror::new(make_tree(), 1);
        mirror.apply_patch(
            &[PatchOp {
                op: PatchOpKind::Add,
                path: "/children/counter/meta/salience".into(),
                value: Some(json!(0.9)),
            }],
            2,
        );
        let counter = &mirror.tree().children.as_ref().unwrap()[0];
        assert_eq!(counter.meta.as_ref().unwrap().salience, Some(0.9));
    }

    #[test]
    fn test_remove_meta_field() {
        let mut tree = make_tree();
        tree.meta = Some(NodeMeta {
            summary: Some("hello".into()),
            ..NodeMeta::default()
        });
        let mut mirror = StateMirror::new(tree, 1);
        mirror.apply_patch(
            &[PatchOp {
                op: PatchOpKind::Remove,
                path: "/meta/summary".into(),
                value: None,
            }],
            2,
        );
        assert!(mirror.tree().meta.as_ref().unwrap().summary.is_none());
    }

    #[test]
    fn test_multiple_ops() {
        let mut mirror = StateMirror::new(make_tree(), 1);
        mirror.apply_patch(
            &[
                PatchOp {
                    op: PatchOpKind::Replace,
                    path: "/children/counter/properties/count".into(),
                    value: Some(json!(10)),
                },
                PatchOp {
                    op: PatchOpKind::Add,
                    path: "/properties/version".into(),
                    value: Some(json!("2.0")),
                },
            ],
            2,
        );
        let counter = &mirror.tree().children.as_ref().unwrap()[0];
        assert_eq!(counter.properties.as_ref().unwrap()["count"], 10);
        assert_eq!(
            mirror.tree().properties.as_ref().unwrap()["version"],
            "2.0"
        );
    }
}
