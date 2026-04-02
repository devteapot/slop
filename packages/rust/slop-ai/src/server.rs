//! SLOP server — manages registrations, connections, subscriptions, and message routing.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use serde_json::{json, Value};

use crate::descriptor::ActionHandler;
use crate::diff::diff_nodes;
use crate::error::Result;
use crate::scaling::{get_subtree, prepare_tree, OutputTreeOptions};
use crate::tree::assemble_tree;
use crate::types::SlopNode;

/// A connected consumer.
pub trait Connection: Send + Sync {
    fn send(&self, message: &Value) -> Result<()>;
    fn close(&self) -> Result<()>;
}

struct Subscription {
    id: String,
    path: String,
    depth: Option<usize>,
    max_nodes: Option<usize>,
    filter_types: Option<Vec<String>>,
    filter_min_salience: Option<f64>,
    connection: Arc<dyn Connection>,
    last_tree: Option<SlopNode>,
}

/// Options for action registration.
pub struct ActionOptions {
    pub label: Option<String>,
    pub description: Option<String>,
    pub dangerous: bool,
    pub idempotent: bool,
    pub estimate: Option<String>,
    pub params: Option<Value>,
}

impl ActionOptions {
    pub fn new() -> Self {
        Self {
            label: None,
            description: None,
            dangerous: false,
            idempotent: false,
            estimate: None,
            params: None,
        }
    }

    pub fn label(mut self, label: impl Into<String>) -> Self {
        self.label = Some(label.into());
        self
    }

    pub fn description(mut self, desc: impl Into<String>) -> Self {
        self.description = Some(desc.into());
        self
    }

    pub fn dangerous(mut self, v: bool) -> Self {
        self.dangerous = v;
        self
    }

    pub fn idempotent(mut self, v: bool) -> Self {
        self.idempotent = v;
        self
    }

    pub fn estimate(mut self, est: impl Into<String>) -> Self {
        self.estimate = Some(est.into());
        self
    }

    pub fn params(mut self, params: Value) -> Self {
        self.params = Some(params);
        self
    }
}

impl Default for ActionOptions {
    fn default() -> Self {
        Self::new()
    }
}

type ActionHandlerFn = dyn Fn(&Value) -> Result<Option<Value>> + Send + Sync;

struct Inner {
    id: String,
    name: String,
    static_registrations: HashMap<String, Value>,
    dynamic_registrations: HashMap<String, Box<dyn Fn() -> Value + Send + Sync>>,
    action_handlers: HashMap<String, Arc<ActionHandlerFn>>,
    action_metadata: HashMap<String, Value>,
    current_tree: SlopNode,
    current_handlers: HashMap<String, ActionHandler>,
    version: u64,
    subscriptions: Vec<Subscription>,
    connections: Vec<Arc<dyn Connection>>,
    change_listeners: Vec<Box<dyn Fn() + Send + Sync>>,
}

/// SLOP server provider.
///
/// Manages node registrations, connections, and message routing.
/// Thread-safe — can be shared across threads via `Clone` (it wraps `Arc`).
///
/// # Example
///
/// ```
/// use slop_ai::SlopServer;
/// use serde_json::json;
///
/// let mut slop = SlopServer::new("my-app", "My App");
/// slop.register("status", json!({"type": "status", "props": {"healthy": true}}));
/// assert_eq!(slop.version(), 1);
/// ```
pub struct SlopServer {
    inner: Arc<RwLock<Inner>>,
}

impl Clone for SlopServer {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl SlopServer {
    /// Create a new SLOP server with the given provider ID and name.
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        let id = id.into();
        let name = name.into();
        Self {
            inner: Arc::new(RwLock::new(Inner {
                current_tree: SlopNode::new(&id, "root"),
                id,
                name,
                static_registrations: HashMap::new(),
                dynamic_registrations: HashMap::new(),
                action_handlers: HashMap::new(),
                action_metadata: HashMap::new(),
                current_handlers: HashMap::new(),
                version: 0,
                subscriptions: Vec::new(),
                connections: Vec::new(),
                change_listeners: Vec::new(),
            })),
        }
    }

    /// Current state tree.
    pub fn tree(&self) -> SlopNode {
        self.inner.read().unwrap().current_tree.clone()
    }

    /// Current version number.
    pub fn version(&self) -> u64 {
        self.inner.read().unwrap().version
    }

    /// Register a static node descriptor at `path`.
    pub fn register(&self, path: impl Into<String>, descriptor: Value) {
        let path = path.into();
        let mut inner = self.inner.write().unwrap();
        inner.dynamic_registrations.remove(&path);
        // Merge action metadata into descriptor
        let merged = merge_action_metadata(&path, descriptor, &inner.action_metadata);
        inner.static_registrations.insert(path, merged);
        rebuild(&mut inner);
    }

    /// Register a descriptor function re-evaluated on `refresh()`.
    pub fn register_fn<F>(&self, path: impl Into<String>, f: F)
    where
        F: Fn() -> Value + Send + Sync + 'static,
    {
        let path = path.into();
        let mut inner = self.inner.write().unwrap();
        inner.static_registrations.remove(&path);
        inner.dynamic_registrations.insert(path, Box::new(f));
        rebuild(&mut inner);
    }

    /// Register an action handler at `path/name`.
    pub fn action<F>(&self, path: impl Into<String>, name: impl Into<String>, handler: F)
    where
        F: Fn(&Value) -> Result<Option<Value>> + Send + Sync + 'static,
    {
        let path = path.into();
        let name = name.into();
        let key = if path.is_empty() { name.clone() } else { format!("{path}/{name}") };
        let mut inner = self.inner.write().unwrap();
        inner.action_handlers.insert(key.clone(), Arc::new(handler));
        // Store minimal metadata for the affordance
        inner
            .action_metadata
            .entry(path.clone())
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .unwrap()
            .insert(name, json!({}));
        // Re-merge if path is statically registered
        if let Some(desc) = inner.static_registrations.remove(&path) {
            let merged = merge_action_metadata(&path, desc, &inner.action_metadata);
            inner.static_registrations.insert(path, merged);
            rebuild(&mut inner);
        }
    }

    /// Register an action handler with metadata (label, dangerous, etc.).
    pub fn action_with<F>(
        &self,
        path: impl Into<String>,
        name: impl Into<String>,
        handler: F,
        options: ActionOptions,
    ) where
        F: Fn(&Value) -> Result<Option<Value>> + Send + Sync + 'static,
    {
        let path = path.into();
        let name = name.into();
        let key = if path.is_empty() { name.clone() } else { format!("{path}/{name}") };
        let mut inner = self.inner.write().unwrap();
        inner.action_handlers.insert(key.clone(), Arc::new(handler));

        let mut meta = serde_json::Map::new();
        if let Some(label) = &options.label {
            meta.insert("label".into(), json!(label));
        }
        if let Some(desc) = &options.description {
            meta.insert("description".into(), json!(desc));
        }
        if options.dangerous {
            meta.insert("dangerous".into(), json!(true));
        }
        if options.idempotent {
            meta.insert("idempotent".into(), json!(true));
        }
        if let Some(est) = &options.estimate {
            meta.insert("estimate".into(), json!(est));
        }
        if let Some(params) = &options.params {
            meta.insert("params".into(), params.clone());
        }

        inner
            .action_metadata
            .entry(path.clone())
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .unwrap()
            .insert(name, Value::Object(meta));

        if let Some(desc) = inner.static_registrations.remove(&path) {
            let merged = merge_action_metadata(&path, desc, &inner.action_metadata);
            inner.static_registrations.insert(path, merged);
            rebuild(&mut inner);
        }
    }

    /// Remove the registration at `path`.
    pub fn unregister(&self, path: &str) {
        let mut inner = self.inner.write().unwrap();
        inner.static_registrations.remove(path);
        inner.dynamic_registrations.remove(path);
        rebuild(&mut inner);
    }

    /// Return a scoped server that prefixes all paths.
    pub fn scope(&self, prefix: impl Into<String>) -> ScopedServer {
        ScopedServer {
            server: self.clone(),
            prefix: prefix.into(),
        }
    }

    /// Re-evaluate all dynamic registrations, diff, and broadcast patches.
    pub fn refresh(&self) {
        let mut inner = self.inner.write().unwrap();
        rebuild(&mut inner);
    }

    // --- Connection lifecycle ---

    /// Handle a new consumer connection.
    pub fn handle_connection(&self, conn: Arc<dyn Connection>) {
        let inner = self.inner.read().unwrap();
        let _ = conn.send(&json!({
            "type": "hello",
            "provider": {
                "id": inner.id,
                "name": inner.name,
                "slop_version": "0.1",
                "capabilities": ["state", "patches", "affordances", "attention", "windowing", "async", "content_refs"]
            }
        }));
        drop(inner);
        self.inner.write().unwrap().connections.push(conn);
    }

    /// Emit an event to all connected consumers.
    pub fn emit_event(&self, name: &str, data: Option<Value>) {
        let inner = self.inner.read().unwrap();
        let mut msg = json!({ "type": "event", "name": name });
        if let Some(d) = data {
            msg["data"] = d;
        }
        for conn in &inner.connections {
            let _ = conn.send(&msg);
        }
    }

    /// Process an incoming message from a consumer.
    pub fn handle_message(&self, conn: &Arc<dyn Connection>, msg: &Value) {
        let msg_type = msg["type"].as_str().unwrap_or("");
        let msg_id = msg["id"].as_str().unwrap_or("").to_string();
        match msg_type {
            "subscribe" => {
                let sub_id = msg_id;
                let path = msg["path"].as_str().unwrap_or("/").to_string();
                let depth = parse_depth(msg);
                let max_nodes = msg.get("max_nodes").and_then(|v| v.as_u64()).map(|v| v as usize);
                let filter_types = parse_filter_types(msg);
                let filter_min_salience = msg.get("filter")
                    .and_then(|f| f.get("min_salience"))
                    .and_then(|v| v.as_f64());

                let inner = self.inner.read().unwrap();

                // Resolve subtree; send error if path not found
                let output = get_output_tree(
                    &inner.current_tree, &path, depth, max_nodes,
                    filter_min_salience, filter_types.as_deref(),
                );

                match output {
                    None => {
                        let _ = conn.send(&json!({
                            "type": "error",
                            "id": sub_id,
                            "error": {
                                "code": "not_found",
                                "message": format!("Path {} does not exist in the state tree", path)
                            }
                        }));
                    }
                    Some(tree) => {
                        let _ = conn.send(&json!({
                            "type": "snapshot",
                            "id": sub_id,
                            "version": inner.version,
                            "tree": serde_json::to_value(&tree).unwrap()
                        }));
                        let last_tree = Some(tree);
                        drop(inner);
                        self.inner.write().unwrap().subscriptions.push(Subscription {
                            id: sub_id,
                            path,
                            depth,
                            max_nodes,
                            filter_types,
                            filter_min_salience,
                            connection: Arc::clone(conn),
                            last_tree,
                        });
                    }
                }
            }
            "unsubscribe" => {
                let sub_id = msg["id"].as_str().unwrap_or("");
                self.inner.write().unwrap().subscriptions.retain(|s| s.id != sub_id);
            }
            "query" => {
                let path = msg["path"].as_str().unwrap_or("/").to_string();
                let depth = parse_depth(msg);
                let max_nodes = msg.get("max_nodes").and_then(|v| v.as_u64()).map(|v| v as usize);
                let filter_types = parse_filter_types(msg);
                let filter_min_salience = msg.get("filter")
                    .and_then(|f| f.get("min_salience"))
                    .and_then(|v| v.as_f64());
                let window = msg.get("window").and_then(|w| {
                    let arr = w.as_array()?;
                    if arr.len() == 2 {
                        Some((arr[0].as_u64()? as usize, arr[1].as_u64()? as usize))
                    } else {
                        None
                    }
                });

                let inner = self.inner.read().unwrap();
                let output = get_output_tree(
                    &inner.current_tree, &path, depth, max_nodes,
                    filter_min_salience, filter_types.as_deref(),
                );

                match output {
                    None => {
                        let _ = conn.send(&json!({
                            "type": "error",
                            "id": msg_id,
                            "error": {
                                "code": "not_found",
                                "message": format!("Path {} does not exist in the state tree", path)
                            }
                        }));
                    }
                    Some(mut tree) => {
                        // Apply window to children
                        if let Some((offset, count)) = window {
                            if let Some(children) = &tree.children {
                                let total = children.len();
                                let start = offset.min(total);
                                let end = (offset + count).min(total);
                                let windowed: Vec<SlopNode> = children[start..end].to_vec();
                                tree.children = if windowed.is_empty() { None } else { Some(windowed) };
                                // Record window metadata
                                let meta = tree.meta.get_or_insert_with(Default::default);
                                meta.total_children = Some(total);
                                meta.window = Some((offset, count));
                            }
                        }
                        let _ = conn.send(&json!({
                            "type": "snapshot",
                            "id": msg_id,
                            "version": inner.version,
                            "tree": serde_json::to_value(&tree).unwrap()
                        }));
                    }
                }
            }
            "invoke" => {
                self.handle_invoke(conn, msg);
            }
            _ => {
                let _ = conn.send(&json!({
                    "type": "error",
                    "id": msg_id,
                    "error": {
                        "code": "bad_request",
                        "message": "Unknown message type"
                    }
                }));
            }
        }
    }

    /// Handle a consumer disconnect.
    pub fn handle_disconnect(&self, conn: &Arc<dyn Connection>) {
        let mut inner = self.inner.write().unwrap();
        let conn_ptr = Arc::as_ptr(conn);
        inner.connections.retain(|c| !Arc::ptr_eq(c, conn));
        inner.subscriptions.retain(|s| !std::ptr::addr_eq(Arc::as_ptr(&s.connection), conn_ptr));
    }

    /// Register a callback fired after each tree change.
    pub fn on_change<F: Fn() + Send + Sync + 'static>(&self, callback: F) {
        self.inner.write().unwrap().change_listeners.push(Box::new(callback));
    }

    /// Close all connections and clean up.
    pub fn stop(&self) {
        let mut inner = self.inner.write().unwrap();
        for conn in &inner.connections {
            let _ = conn.close();
        }
        inner.connections.clear();
        inner.subscriptions.clear();
    }

    fn handle_invoke(&self, conn: &Arc<dyn Connection>, msg: &Value) {
        let path = msg["path"].as_str().unwrap_or("");
        let action = msg["action"].as_str().unwrap_or("");
        let params = msg.get("params").cloned().unwrap_or(json!({}));
        let msg_id = msg["id"].as_str().unwrap_or("").to_string();

        // Clone handler out so we can drop the lock before calling it
        let handler = {
            let inner = self.inner.read().unwrap();
            let handler_key = resolve_handler_key(&inner, path, action);
            inner
                .current_handlers
                .get(&handler_key)
                .cloned()
                .or_else(|| inner.action_handlers.get(&handler_key).cloned())
        };

        match handler {
            None => {
                let _ = conn.send(&json!({
                    "type": "result",
                    "id": msg_id,
                    "status": "error",
                    "error": {"code": "not_found", "message": format!("No handler for {action} at {path}")}
                }));
            }
            Some(h) => {
                match h(&params) {
                    Ok(data) => {
                        let is_async = data
                            .as_ref()
                            .and_then(|d| d.get("__async"))
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        let mut resp = json!({
                            "type": "result",
                            "id": msg_id,
                            "status": if is_async { "accepted" } else { "ok" }
                        });
                        if let Some(d) = &data {
                            if let Some(obj) = d.as_object() {
                                let filtered: serde_json::Map<String, Value> = obj
                                    .iter()
                                    .filter(|(k, _)| k.as_str() != "__async")
                                    .map(|(k, v)| (k.clone(), v.clone()))
                                    .collect();
                                if !filtered.is_empty() {
                                    resp["data"] = Value::Object(filtered);
                                }
                            }
                        }
                        let _ = conn.send(&resp);
                    }
                    Err(e) => {
                        let _ = conn.send(&json!({
                            "type": "result",
                            "id": msg_id,
                            "status": "error",
                            "error": {"code": "internal", "message": e.to_string()}
                        }));
                    }
                }
                // Auto-refresh after invoke
                self.refresh();
            }
        }
    }
}

/// A scoped view of a `SlopServer` that prefixes all paths.
pub struct ScopedServer {
    server: SlopServer,
    prefix: String,
}

impl ScopedServer {
    pub fn register(&self, path: &str, descriptor: Value) {
        self.server.register(format!("{}/{path}", self.prefix), descriptor);
    }

    pub fn register_fn<F>(&self, path: &str, f: F)
    where
        F: Fn() -> Value + Send + Sync + 'static,
    {
        self.server.register_fn(format!("{}/{path}", self.prefix), f);
    }

    pub fn action<F>(&self, path: &str, name: impl Into<String>, handler: F)
    where
        F: Fn(&Value) -> Result<Option<Value>> + Send + Sync + 'static,
    {
        self.server.action(format!("{}/{path}", self.prefix), name, handler);
    }

    pub fn unregister(&self, path: &str) {
        self.server.unregister(&format!("{}/{path}", self.prefix));
    }

    pub fn scope(&self, sub_prefix: &str) -> ScopedServer {
        self.server.scope(format!("{}/{sub_prefix}", self.prefix))
    }

    pub fn refresh(&self) {
        self.server.refresh();
    }
}

// --- Internal helpers ---

fn rebuild(inner: &mut Inner) {
    let mut all_descriptors: HashMap<String, Value> = HashMap::new();

    // Evaluate dynamic registrations
    for (path, f) in &inner.dynamic_registrations {
        let desc = f();
        let merged = merge_action_metadata(path, desc, &inner.action_metadata);
        all_descriptors.insert(path.clone(), merged);
    }

    // Static registrations
    for (path, desc) in &inner.static_registrations {
        all_descriptors.insert(path.clone(), desc.clone());
    }

    let (tree, handlers) = assemble_tree(&all_descriptors, &inner.id, &inner.name);
    let ops = diff_nodes(&inner.current_tree, &tree, "");

    // Merge descriptor handlers with explicitly registered action handlers
    let merged_handlers = handlers;
    // action_handlers take precedence (registered via .action())
    // but we can't move out of inner, so we skip merging here — lookups check both maps.
    inner.current_handlers = merged_handlers;

    if !ops.is_empty() {
        inner.current_tree = tree;
        inner.version += 1;
        broadcast_patches(inner);
        for listener in &inner.change_listeners {
            listener();
        }
    } else if inner.version == 0 {
        inner.current_tree = tree;
        inner.version = 1;
    }
}

fn broadcast_patches(inner: &mut Inner) {
    for sub in &mut inner.subscriptions {
        // Compute per-subscription output tree using stored path/depth/filter
        let new_tree = get_output_tree(
            &inner.current_tree,
            &sub.path,
            sub.depth,
            sub.max_nodes,
            sub.filter_min_salience,
            sub.filter_types.as_deref(),
        );

        let new_tree = match new_tree {
            Some(t) => t,
            None => continue, // path no longer exists — skip
        };

        let ops = match &sub.last_tree {
            Some(old) => diff_nodes(old, &new_tree, ""),
            None => diff_nodes(
                &SlopNode::new(&inner.id, "root"),
                &new_tree,
                "",
            ),
        };
        if !ops.is_empty() {
            let ops_val = serde_json::to_value(&ops).unwrap();
            let _ = sub.connection.send(&json!({
                "type": "patch",
                "subscription": sub.id,
                "version": inner.version,
                "ops": ops_val
            }));
        }
        sub.last_tree = Some(new_tree);
    }
}

fn resolve_handler_key(inner: &Inner, path: &str, action: &str) -> String {
    let root_prefix = format!("/{}/", inner.id);
    let clean = if path.starts_with(&root_prefix) {
        &path[root_prefix.len()..]
    } else if let Some(stripped) = path.strip_prefix('/') {
        stripped
    } else {
        path
    };

    if clean.is_empty() {
        action.to_string()
    } else {
        format!("{clean}/{action}")
    }
}

/// Resolve a subtree at `path`, then apply depth/filter/max_nodes via `prepare_tree`.
/// Returns `None` if the path does not exist.
fn get_output_tree(
    full_tree: &SlopNode,
    path: &str,
    depth: Option<usize>,
    max_nodes: Option<usize>,
    min_salience: Option<f64>,
    types: Option<&[String]>,
) -> Option<SlopNode> {
    let subtree = if path.is_empty() || path == "/" {
        full_tree
    } else {
        get_subtree(full_tree, path)?
    };

    let opts = OutputTreeOptions {
        max_depth: depth,
        max_nodes,
        min_salience,
        types: types.map(|t| t.to_vec()),
    };
    Some(prepare_tree(subtree, &opts))
}

/// Parse the `depth` field from a subscribe/query message.
/// Returns `None` for unlimited (-1 or absent).
fn parse_depth(msg: &Value) -> Option<usize> {
    match msg.get("depth").and_then(|v| v.as_i64()) {
        Some(d) if d >= 0 => Some(d as usize),
        _ => None,
    }
}

/// Parse the `filter.types` array from a subscribe/query message.
fn parse_filter_types(msg: &Value) -> Option<Vec<String>> {
    msg.get("filter")
        .and_then(|f| f.get("types"))
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
}

fn merge_action_metadata(
    path: &str,
    mut descriptor: Value,
    action_metadata: &HashMap<String, Value>,
) -> Value {
    if let Some(meta) = action_metadata.get(path) {
        if let Some(meta_obj) = meta.as_object() {
            if !meta_obj.is_empty() {
                let desc_obj = descriptor.as_object_mut().unwrap();
                // If the descriptor already defines actions, treat it as
                // authoritative — don't add registered actions that aren't
                // listed. This supports state-dependent affordances where
                // the descriptor intentionally omits certain actions.
                if desc_obj.contains_key("actions") {
                    // Only enrich existing actions with metadata, don't add new ones
                    let actions = desc_obj["actions"].as_object_mut().unwrap();
                    for (name, opts) in meta_obj {
                        if actions.contains_key(name) {
                            // Merge metadata into existing action (fill gaps)
                            if let (Some(existing), Some(new)) =
                                (actions.get_mut(name).and_then(|v| v.as_object_mut()), opts.as_object())
                            {
                                for (k, v) in new {
                                    if !existing.contains_key(k) {
                                        existing.insert(k.clone(), v.clone());
                                    }
                                }
                            }
                        }
                    }
                } else {
                    // No actions in descriptor — add all registered actions
                    let actions = desc_obj
                        .entry("actions")
                        .or_insert_with(|| json!({}))
                        .as_object_mut()
                        .unwrap();
                    for (name, opts) in meta_obj {
                        if !actions.contains_key(name) {
                            actions.insert(name.clone(), opts.clone());
                        }
                    }
                }
            }
        }
    }
    descriptor
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct MockConnection {
        messages: Mutex<Vec<Value>>,
    }

    impl MockConnection {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                messages: Mutex::new(Vec::new()),
            })
        }

        fn messages(&self) -> Vec<Value> {
            self.messages.lock().unwrap().clone()
        }
    }

    impl Connection for MockConnection {
        fn send(&self, message: &Value) -> Result<()> {
            self.messages.lock().unwrap().push(message.clone());
            Ok(())
        }
        fn close(&self) -> Result<()> {
            Ok(())
        }
    }

    #[test]
    fn test_register_static() {
        let slop = SlopServer::new("app", "App");
        slop.register("status", json!({"type": "status", "props": {"healthy": true}}));
        assert_eq!(slop.version(), 1);
        let tree = slop.tree();
        assert_eq!(tree.children.as_ref().unwrap().len(), 1);
        assert_eq!(tree.children.as_ref().unwrap()[0].id, "status");
    }

    #[test]
    fn test_register_fn() {
        let counter = Arc::new(Mutex::new(0));
        let slop = SlopServer::new("app", "App");

        let c = counter.clone();
        slop.register_fn("counter", move || {
            let n = *c.lock().unwrap();
            json!({"type": "status", "props": {"count": n}})
        });

        assert_eq!(slop.tree().children.as_ref().unwrap()[0].properties.as_ref().unwrap()["count"], 0);

        *counter.lock().unwrap() = 5;
        slop.refresh();
        assert_eq!(slop.tree().children.as_ref().unwrap()[0].properties.as_ref().unwrap()["count"], 5);
    }

    fn as_dyn(conn: &Arc<MockConnection>) -> Arc<dyn Connection> {
        conn.clone() as Arc<dyn Connection>
    }

    #[test]
    fn test_connection_lifecycle() {
        let slop = SlopServer::new("app", "App");
        slop.register("x", json!({"type": "group"}));

        let conn = MockConnection::new();
        let dyn_conn = as_dyn(&conn);
        slop.handle_connection(dyn_conn.clone());

        let messages = conn.messages();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["type"], "hello");
        assert_eq!(messages[0]["provider"]["id"], "app");

        // Subscribe
        slop.handle_message(&dyn_conn, &json!({"type": "subscribe", "id": "sub-1"}));
        let messages = conn.messages();
        assert_eq!(messages[1]["type"], "snapshot");
        assert_eq!(messages[1]["id"], "sub-1");

        // Query
        slop.handle_message(&dyn_conn, &json!({"type": "query", "id": "q-1"}));
        let messages = conn.messages();
        assert_eq!(messages[2]["type"], "snapshot");
        assert_eq!(messages[2]["id"], "q-1");

        // Disconnect
        slop.handle_disconnect(&dyn_conn);
    }

    #[test]
    fn test_invoke() {
        let state = Arc::new(Mutex::new(0i32));
        let slop = SlopServer::new("app", "App");
        slop.register("counter", json!({"type": "status", "props": {"count": 0}}));

        let s = state.clone();
        slop.action("counter", "increment", move |_params: &Value| {
            *s.lock().unwrap() += 1;
            Ok(None)
        });

        let conn = MockConnection::new();
        let dyn_conn = as_dyn(&conn);
        slop.handle_connection(dyn_conn.clone());
        slop.handle_message(&dyn_conn, &json!({
            "type": "invoke",
            "id": "inv-1",
            "path": "/app/counter",
            "action": "increment"
        }));

        let messages = conn.messages();
        let result = messages.iter().find(|m| m["type"] == "result").unwrap();
        assert_eq!(result["status"], "ok");
        assert_eq!(*state.lock().unwrap(), 1);
    }

    #[test]
    fn test_invoke_not_found() {
        let slop = SlopServer::new("app", "App");
        let conn = MockConnection::new();
        let dyn_conn = as_dyn(&conn);
        slop.handle_connection(dyn_conn.clone());
        slop.handle_message(&dyn_conn, &json!({
            "type": "invoke",
            "id": "inv-1",
            "path": "/app/missing",
            "action": "do_it"
        }));

        let messages = conn.messages();
        let result = messages.iter().find(|m| m["type"] == "result").unwrap();
        assert_eq!(result["status"], "error");
        assert_eq!(result["error"]["code"], "not_found");
    }

    #[test]
    fn test_scope() {
        let slop = SlopServer::new("app", "App");
        let settings = slop.scope("settings");
        settings.register("account", json!({"type": "group", "props": {"email": "a@b.com"}}));

        let tree = slop.tree();
        let settings_node = &tree.children.as_ref().unwrap()[0];
        assert_eq!(settings_node.id, "settings");
        assert_eq!(settings_node.children.as_ref().unwrap()[0].id, "account");
    }

    #[test]
    fn test_unregister() {
        let slop = SlopServer::new("app", "App");
        slop.register("x", json!({"type": "group"}));
        assert_eq!(slop.tree().children.as_ref().unwrap().len(), 1);

        slop.unregister("x");
        assert!(slop.tree().children.as_ref().map_or(true, |c| c.is_empty()));
    }

    #[test]
    fn test_broadcast_on_change() {
        let slop = SlopServer::new("app", "App");
        slop.register("x", json!({"type": "group", "props": {"v": 1}}));

        let conn = MockConnection::new();
        let dyn_conn = as_dyn(&conn);
        slop.handle_connection(dyn_conn.clone());
        slop.handle_message(&dyn_conn, &json!({"type": "subscribe", "id": "sub-1"}));
        let initial_count = conn.messages().len();

        slop.register("x", json!({"type": "group", "props": {"v": 2}}));
        assert!(conn.messages().len() > initial_count);
    }

    #[test]
    fn test_subscribe_with_depth_limit() {
        let slop = SlopServer::new("app", "App");
        // Register a nested structure using flat path registrations
        slop.register("parent", json!({"type": "group"}));
        slop.register("parent/child", json!({"type": "group"}));
        slop.register("parent/child/grandchild", json!({"type": "item"}));

        let conn = MockConnection::new();
        let dyn_conn = as_dyn(&conn);
        slop.handle_connection(dyn_conn.clone());

        // Subscribe with depth 1 — at depth=1, root shows children, but parent's
        // children (child) are collapsed to stubs.
        slop.handle_message(&dyn_conn, &json!({
            "type": "subscribe",
            "id": "sub-depth",
            "path": "/",
            "depth": 1
        }));

        let messages = conn.messages();
        let snapshot = messages.iter().find(|m| m["type"] == "snapshot").unwrap();
        assert_eq!(snapshot["id"], "sub-depth");

        let tree_val = &snapshot["tree"];
        let parent = tree_val["children"]
            .as_array().unwrap()
            .iter()
            .find(|c| c["id"] == "parent")
            .unwrap();
        // At depth=1 from root: parent is at depth 0, its children are at depth 1
        // which triggers truncation (depth <= 0 on the children pass).
        // parent should be a stub with no children and meta.total_children set
        assert!(parent.get("children").is_none() || parent["children"].is_null());
        assert_eq!(parent["meta"]["total_children"], 1);
    }

    #[test]
    fn test_subscribe_with_salience_filter() {
        let slop = SlopServer::new("app", "App");
        // Register two nodes with different salience
        slop.register("high", json!({
            "type": "item",
            "meta": {"salience": 0.9}
        }));
        slop.register("low", json!({
            "type": "item",
            "meta": {"salience": 0.1}
        }));

        let conn = MockConnection::new();
        let dyn_conn = as_dyn(&conn);
        slop.handle_connection(dyn_conn.clone());

        slop.handle_message(&dyn_conn, &json!({
            "type": "subscribe",
            "id": "sub-filter",
            "path": "/",
            "filter": {"min_salience": 0.5}
        }));

        let messages = conn.messages();
        let snapshot = messages.iter().find(|m| m["type"] == "snapshot").unwrap();
        let children = snapshot["tree"]["children"].as_array().unwrap();

        // Only high-salience node should be present
        assert_eq!(children.len(), 1);
        assert_eq!(children[0]["id"], "high");
    }

    #[test]
    fn test_unknown_message_returns_error() {
        let slop = SlopServer::new("app", "App");
        let conn = MockConnection::new();
        let dyn_conn = as_dyn(&conn);
        slop.handle_connection(dyn_conn.clone());

        slop.handle_message(&dyn_conn, &json!({
            "type": "bogus",
            "id": "req-99"
        }));

        let messages = conn.messages();
        let error = messages.iter().find(|m| m["type"] == "error").unwrap();
        assert_eq!(error["id"], "req-99");
        assert_eq!(error["error"]["code"], "bad_request");
    }

    #[test]
    fn test_subscribe_bad_path_returns_error() {
        let slop = SlopServer::new("app", "App");
        slop.register("x", json!({"type": "group"}));

        let conn = MockConnection::new();
        let dyn_conn = as_dyn(&conn);
        slop.handle_connection(dyn_conn.clone());

        slop.handle_message(&dyn_conn, &json!({
            "type": "subscribe",
            "id": "sub-bad",
            "path": "/nonexistent/deep"
        }));

        let messages = conn.messages();
        let error = messages.iter().find(|m| m["type"] == "error").unwrap();
        assert_eq!(error["id"], "sub-bad");
        assert_eq!(error["error"]["code"], "not_found");
    }

    #[test]
    fn test_emit_event() {
        let slop = SlopServer::new("app", "App");

        let conn = MockConnection::new();
        let dyn_conn = as_dyn(&conn);
        slop.handle_connection(dyn_conn.clone());

        slop.emit_event("user-navigation", Some(json!({"from": "/a", "to": "/b"})));

        let messages = conn.messages();
        let event = messages.iter().find(|m| m["type"] == "event").unwrap();
        assert_eq!(event["name"], "user-navigation");
        assert_eq!(event["data"]["from"], "/a");
        assert_eq!(event["data"]["to"], "/b");
    }

    #[test]
    fn test_emit_event_no_data() {
        let slop = SlopServer::new("app", "App");

        let conn = MockConnection::new();
        let dyn_conn = as_dyn(&conn);
        slop.handle_connection(dyn_conn.clone());

        slop.emit_event("heartbeat", None);

        let messages = conn.messages();
        let event = messages.iter().find(|m| m["type"] == "event").unwrap();
        assert_eq!(event["name"], "heartbeat");
        assert!(event.get("data").is_none());
    }

    #[test]
    fn test_query_with_window() {
        let slop = SlopServer::new("app", "App");
        // Register a collection with items (array children)
        slop.register("items", json!({
            "type": "collection",
            "items": [
                {"id": "a", "type": "item"},
                {"id": "b", "type": "item"},
                {"id": "c", "type": "item"},
                {"id": "d", "type": "item"},
                {"id": "e", "type": "item"}
            ]
        }));

        let conn = MockConnection::new();
        let dyn_conn = as_dyn(&conn);
        slop.handle_connection(dyn_conn.clone());

        // Query with window [1, 2] — should get items b and c
        // Path is /items (child of root)
        slop.handle_message(&dyn_conn, &json!({
            "type": "query",
            "id": "q-win",
            "path": "/items",
            "depth": -1,
            "window": [1, 2]
        }));

        let messages = conn.messages();
        let snapshot = messages.iter().find(|m| m["id"] == "q-win").unwrap();
        let children = snapshot["tree"]["children"].as_array().unwrap();
        assert_eq!(children.len(), 2);
        assert_eq!(children[0]["id"], "b");
        assert_eq!(children[1]["id"], "c");
        // Metadata should record the window
        assert_eq!(snapshot["tree"]["meta"]["total_children"], 5);
    }
}
