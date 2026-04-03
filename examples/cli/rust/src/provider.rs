use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use serde_json::{json, Value};

use slop_ai::{ActionOptions, SlopServer};

use crate::store::{compute_salience, content_ref_for, Store, Task};

const WINDOW_SIZE: usize = 25;

pub fn setup_provider(store: Arc<Mutex<Store>>) -> SlopServer {
    let slop = SlopServer::new("tsk", "tsk");

    // --- Search action on tasks collection ---
    {
        let s = store.clone();
        slop.action_with(
            "tasks",
            "search",
            move |params: &Value| {
                let query = params["query"].as_str().unwrap_or("");
                let tasks = s.lock().unwrap().load();
                let q = query.to_lowercase();
                let matches: Vec<Value> = tasks
                    .iter()
                    .filter(|t| {
                        t.title.to_lowercase().contains(&q)
                            || t.tags.iter().any(|tag| tag.to_lowercase().contains(&q))
                    })
                    .map(|t| {
                        json!({
                            "id": t.id,
                            "title": &t.title,
                            "done": t.done,
                            "tags": &t.tags,
                        })
                    })
                    .collect();
                Ok(Some(json!({ "results": matches, "count": matches.len() })))
            },
            ActionOptions::new()
                .label("Search tasks")
                .description("Search tasks by title or tag")
                .idempotent(true)
                .estimate("instant")
                .params(json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "Search term (matches title and tags)" }
                    },
                    "required": ["query"]
                })),
        );
    }

    // --- Static: user context ---
    {
        let s = store.clone();
        slop.register_fn("user", move || {
            let st = s.lock().unwrap();
            let tasks = st.load();
            let total = tasks.len();
            let done = tasks.iter().filter(|t| t.done).count();
            json!({
                "type": "context",
                "props": {
                    "file": st.path.display().to_string(),
                    "total_tasks": total,
                    "total_done": done,
                },
            })
        });
    }

    // --- Dynamic: tasks collection ---
    {
        let s = store.clone();
        slop.register_fn("tasks", move || {
            let st = s.lock().unwrap();
            let tasks = st.load();
            build_tasks_descriptor(&tasks)
        });
    }

    // --- Dynamic: tags collection ---
    {
        let s = store.clone();
        slop.register_fn("tags", move || {
            let st = s.lock().unwrap();
            let tasks = st.load();
            build_tags_descriptor(&tasks)
        });
    }

    // --- Task actions on the collection ---
    register_collection_actions(&slop, store.clone());

    // --- Per-item actions (registered at "tasks" path, but handled via item path) ---
    register_item_actions(&slop, store.clone());

    // --- Tags actions ---
    {
        let s = store.clone();
        slop.action_with(
            "tags",
            "rename",
            move |params: &Value| {
                let old = params["old"].as_str().unwrap_or("");
                let new = params["new"].as_str().unwrap_or("");
                if old.is_empty() || new.is_empty() {
                    return Err(slop_ai::SlopError::ActionFailed {
                        code: "invalid_params".into(),
                        message: "old and new are required".into(),
                    });
                }
                let st = s.lock().unwrap();
                let mut tasks = st.load();
                let mut count = 0;
                for task in &mut tasks {
                    if let Some(pos) = task.tags.iter().position(|t| t == old) {
                        task.tags[pos] = new.to_string();
                        count += 1;
                    }
                }
                st.save(&tasks);
                Ok(Some(json!({ "renamed": count })))
            },
            ActionOptions::new()
                .label("Rename tag")
                .params(json!({
                    "type": "object",
                    "properties": {
                        "old": { "type": "string" },
                        "new": { "type": "string" }
                    },
                    "required": ["old", "new"]
                })),
        );
    }

    slop
}

fn register_collection_actions(slop: &SlopServer, store: Arc<Mutex<Store>>) {
    // add
    {
        let s = store.clone();
        slop.action_with(
            "tasks",
            "add",
            move |params: &Value| {
                let title = params["title"]
                    .as_str()
                    .ok_or_else(|| slop_ai::SlopError::ActionFailed {
                        code: "invalid_params".into(),
                        message: "title is required".into(),
                    })?;
                let st = s.lock().unwrap();
                let mut tasks = st.load();
                let id = st.next_id(&tasks);

                let due = params["due"].as_str().map(|d| resolve_date(d));
                let tags: Vec<String> = params["tags"]
                    .as_str()
                    .map(|t| t.split(',').map(|s| s.trim().to_string()).collect())
                    .unwrap_or_default();

                tasks.push(Task {
                    id: id.clone(),
                    title: title.to_string(),
                    done: false,
                    due,
                    tags,
                    notes: String::new(),
                    created: Utc::now().to_rfc3339(),
                    completed_at: None,
                });
                st.save(&tasks);
                Ok(Some(json!({ "id": id })))
            },
            ActionOptions::new()
                .label("Add task")
                .estimate("instant")
                .params(json!({
                    "type": "object",
                    "properties": {
                        "title": { "type": "string" },
                        "due": { "type": "string", "description": "ISO date or relative: 'today', 'tomorrow'" },
                        "tags": { "type": "string", "description": "Comma-separated tags" }
                    },
                    "required": ["title"]
                })),
        );
    }

    // clear_done
    {
        let s = store.clone();
        slop.action_with(
            "tasks",
            "clear_done",
            move |_params: &Value| {
                let st = s.lock().unwrap();
                let mut tasks = st.load();
                let before = tasks.len();
                tasks.retain(|t| !t.done);
                let removed = before - tasks.len();
                st.save(&tasks);
                Ok(Some(json!({ "removed": removed })))
            },
            ActionOptions::new()
                .label("Clear completed")
                .dangerous(true)
                .estimate("instant"),
        );
    }

    // export (async-style)
    {
        let s = store.clone();
        slop.action_with(
            "tasks",
            "export",
            move |params: &Value| {
                let format = params["format"].as_str().unwrap_or("json");
                let st = s.lock().unwrap();
                let tasks = st.load();

                let content = match format {
                    "csv" => {
                        let mut out = String::from("id,title,done,due,tags\n");
                        for t in &tasks {
                            let tags = t.tags.join(";");
                            let due = t.due.as_deref().unwrap_or("");
                            out.push_str(&format!("{},{},{},{},{}\n", t.id, t.title, t.done, due, tags));
                        }
                        out
                    }
                    "markdown" => {
                        let mut out = String::from("# Tasks\n\n");
                        for t in &tasks {
                            let check = if t.done { "x" } else { " " };
                            let due = t.due.as_deref().map(|d| format!(" (due: {d})")).unwrap_or_default();
                            out.push_str(&format!("- [{check}] {}{due}\n", t.title));
                        }
                        out
                    }
                    _ => serde_json::to_string_pretty(&tasks).unwrap_or_default(),
                };

                Ok(Some(json!({
                    "format": format,
                    "content": content,
                    "task_count": tasks.len(),
                })))
            },
            ActionOptions::new()
                .label("Export tasks")
                .description("Export tasks to a file")
                .estimate("slow")
                .params(json!({
                    "type": "object",
                    "properties": {
                        "format": { "type": "string", "enum": ["json", "csv", "markdown"] }
                    },
                    "required": ["format"]
                })),
        );
    }
}

fn register_item_actions(slop: &SlopServer, store: Arc<Mutex<Store>>) {
    // Register all action variants for every known task.
    // We register both done/undo for every task; the descriptor controls which
    // affordances are visible, and the handler works regardless of current state.
    // After an "add" action creates a new task, the auto-refresh rebuilds the tree
    // and the new task's affordances come from the descriptor. Its handlers are
    // registered here at setup time only for existing tasks, but new tasks get
    // handlers registered by the "add" action handler.
    let tasks = store.lock().unwrap().load();
    for task in &tasks {
        register_single_task_actions(slop, &store, &task.id);
    }

    // Also patch the "add" handler to register item actions for newly created tasks.
    // Since we can't easily do that, we instead pre-register a generous range of IDs.
    // A more robust approach: register handlers lazily. But for this example, we
    // register up to t-100 to cover new tasks.
    let max_id = tasks
        .iter()
        .filter_map(|t| t.id.strip_prefix("t-").and_then(|n| n.parse::<u32>().ok()))
        .max()
        .unwrap_or(0);
    for i in (max_id + 1)..=(max_id + 100) {
        let tid = format!("t-{i}");
        register_single_task_actions(slop, &store, &tid);
    }
}

fn register_single_task_actions(slop: &SlopServer, store: &Arc<Mutex<Store>>, task_id: &str) {
    let task_path = format!("tasks/{}", task_id);

    // done
    {
        let s = store.clone();
        let tid = task_id.to_string();
        slop.action(&task_path, "done", move |_params: &Value| {
            let st = s.lock().unwrap();
            let mut tasks = st.load();
            if let Some(t) = tasks.iter_mut().find(|t| t.id == tid) {
                t.done = true;
                t.completed_at = Some(Utc::now().to_rfc3339());
                st.save(&tasks);
                Ok(Some(json!({ "id": tid })))
            } else {
                Err(slop_ai::SlopError::ActionFailed {
                    code: "not_found".into(),
                    message: format!("Task {} not found", tid),
                })
            }
        });
    }

    // undo
    {
        let s = store.clone();
        let tid = task_id.to_string();
        slop.action(&task_path, "undo", move |_params: &Value| {
            let st = s.lock().unwrap();
            let mut tasks = st.load();
            if let Some(t) = tasks.iter_mut().find(|t| t.id == tid) {
                t.done = false;
                t.completed_at = None;
                st.save(&tasks);
                Ok(Some(json!({ "id": tid })))
            } else {
                Err(slop_ai::SlopError::ActionFailed {
                    code: "not_found".into(),
                    message: format!("Task {} not found", tid),
                })
            }
        });
    }

    // edit
    {
        let s = store.clone();
        let tid = task_id.to_string();
        slop.action(&task_path, "edit", move |params: &Value| {
            let st = s.lock().unwrap();
            let mut tasks = st.load();
            if let Some(t) = tasks.iter_mut().find(|t| t.id == tid) {
                if let Some(title) = params["title"].as_str() {
                    t.title = title.to_string();
                }
                if let Some(due) = params["due"].as_str() {
                    t.due = Some(resolve_date(due));
                }
                if let Some(tags) = params["tags"].as_str() {
                    t.tags = tags.split(',').map(|s| s.trim().to_string()).collect();
                }
                st.save(&tasks);
                Ok(Some(json!({ "id": tid })))
            } else {
                Err(slop_ai::SlopError::ActionFailed {
                    code: "not_found".into(),
                    message: format!("Task {} not found", tid),
                })
            }
        });
    }

    // delete
    {
        let s = store.clone();
        let tid = task_id.to_string();
        slop.action(&task_path, "delete", move |_params: &Value| {
            let st = s.lock().unwrap();
            let mut tasks = st.load();
            let len_before = tasks.len();
            tasks.retain(|t| t.id != tid);
            if tasks.len() < len_before {
                st.save(&tasks);
                Ok(Some(json!({ "id": tid })))
            } else {
                Err(slop_ai::SlopError::ActionFailed {
                    code: "not_found".into(),
                    message: format!("Task {} not found", tid),
                })
            }
        });
    }

    // read_notes
    {
        let s = store.clone();
        let tid = task_id.to_string();
        slop.action(&task_path, "read_notes", move |_params: &Value| {
            let st = s.lock().unwrap();
            let tasks = st.load();
            if let Some(t) = tasks.iter().find(|t| t.id == tid) {
                Ok(Some(json!({ "content": &t.notes })))
            } else {
                Ok(Some(json!({ "content": "" })))
            }
        });
    }

    // write_notes
    {
        let s = store.clone();
        let tid = task_id.to_string();
        slop.action(&task_path, "write_notes", move |params: &Value| {
            let content = params["content"].as_str().unwrap_or("");
            let st = s.lock().unwrap();
            let mut tasks = st.load();
            if let Some(t) = tasks.iter_mut().find(|t| t.id == tid) {
                t.notes = content.to_string();
                st.save(&tasks);
                Ok(Some(json!({ "id": tid })))
            } else {
                Err(slop_ai::SlopError::ActionFailed {
                    code: "not_found".into(),
                    message: format!("Task {} not found", tid),
                })
            }
        });
    }
}

fn build_tasks_descriptor(tasks: &[Task]) -> Value {
    let total = tasks.len();
    let pending = tasks.iter().filter(|t| !t.done).count();
    let done_count = total - pending;

    // Sort by salience
    let mut sorted: Vec<&Task> = tasks.iter().collect();
    sorted.sort_by(|a, b| {
        let (sa, _, _) = compute_salience(a);
        let (sb, _, _) = compute_salience(b);
        sb.partial_cmp(&sa).unwrap_or(std::cmp::Ordering::Equal)
    });

    let overdue = sorted
        .iter()
        .filter(|t| {
            let (s, _, _) = compute_salience(t);
            s >= 1.0 && !t.done
        })
        .count();

    let window_count = total.min(WINDOW_SIZE);
    let windowed: Vec<&Task> = sorted.iter().take(window_count).copied().collect();

    let items: Vec<Value> = windowed
        .iter()
        .map(|t| {
            let (salience, urgency, reason) = compute_salience(t);

            let mut meta = json!({ "salience": salience });
            if let Some(u) = &urgency {
                meta["urgency"] = json!(u);
            }
            if let Some(r) = &reason {
                meta["reason"] = json!(r);
            }

            let mut props = json!({
                "title": &t.title,
                "done": t.done,
                "tags": &t.tags,
            });
            if let Some(due) = &t.due {
                props["due"] = json!(due);
            }
            if let Some(cat) = &t.completed_at {
                props["completed_at"] = json!(cat);
            }

            // Build actions for this item
            let actions = if t.done {
                json!({
                    "undo": { "label": "Mark incomplete", "estimate": "instant" },
                    "delete": { "label": "Delete task", "dangerous": true, "estimate": "instant" },
                })
            } else {
                json!({
                    "done": { "label": "Complete task", "estimate": "instant" },
                    "edit": {
                        "label": "Edit task",
                        "estimate": "instant",
                        "params": {
                            "type": "object",
                            "properties": {
                                "title": { "type": "string" },
                                "due": { "type": "string" },
                                "tags": { "type": "string" }
                            }
                        }
                    },
                    "delete": { "label": "Delete task", "dangerous": true, "estimate": "instant" },
                    "read_notes": {
                        "label": "Read full notes",
                        "description": "Fetch the complete notes for this task",
                        "idempotent": true,
                        "estimate": "instant"
                    },
                    "write_notes": {
                        "label": "Write notes",
                        "estimate": "instant",
                        "params": {
                            "type": "object",
                            "properties": {
                                "content": { "type": "string" }
                            },
                            "required": ["content"]
                        }
                    },
                })
            };

            // Embed content_ref inside props since normalize_item reads props directly
            if !t.done {
                props["content_ref"] = content_ref_for(t);
            }

            json!({
                "id": &t.id,
                "props": props,
                "meta": meta,
                "actions": actions,
            })
        })
        .collect();

    let summary = format!(
        "{total} tasks: {pending} pending, {done_count} done, {overdue} overdue"
    );

    json!({
        "type": "collection",
        "props": {
            "count": total,
            "pending": pending,
            "overdue": overdue,
        },
        "summary": summary,
        "meta": {
            "total_children": total,
        },
        "window": {
            "items": items,
            "total": total,
            "offset": 0,
        },
        "actions": {
            "add": {
                "label": "Add task",
                "estimate": "instant",
                "params": {
                    "type": "object",
                    "properties": {
                        "title": { "type": "string" },
                        "due": { "type": "string", "description": "ISO date or relative" },
                        "tags": { "type": "string", "description": "Comma-separated tags" }
                    },
                    "required": ["title"]
                }
            },
            "clear_done": {
                "label": "Clear completed",
                "description": "Remove all completed tasks",
                "dangerous": true,
                "estimate": "instant"
            },
            "export": {
                "label": "Export tasks",
                "description": "Export tasks to a file",
                "estimate": "slow",
                "params": {
                    "type": "object",
                    "properties": {
                        "format": { "type": "string", "enum": ["json", "csv", "markdown"] }
                    },
                    "required": ["format"]
                }
            },
            "search": {
                "label": "Search tasks",
                "description": "Search tasks by title or tag",
                "idempotent": true,
                "estimate": "instant",
                "params": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "Search term" }
                    },
                    "required": ["query"]
                }
            }
        },
    })
}

fn build_tags_descriptor(tasks: &[Task]) -> Value {
    let mut tag_counts: HashMap<String, usize> = HashMap::new();
    for task in tasks {
        for tag in &task.tags {
            *tag_counts.entry(tag.clone()).or_default() += 1;
        }
    }

    let mut sorted_tags: Vec<(&String, &usize)> = tag_counts.iter().collect();
    sorted_tags.sort_by(|a, b| b.1.cmp(a.1));

    let tag_summary = sorted_tags
        .iter()
        .map(|(name, count)| format!("{name} ({count})"))
        .collect::<Vec<_>>()
        .join(", ");

    let count = tag_counts.len();

    json!({
        "type": "collection",
        "props": { "count": count },
        "summary": format!("{count} tags: {tag_summary}"),
    })
}

fn resolve_date(input: &str) -> String {
    let today = chrono::Utc::now().date_naive();
    match input.to_lowercase().as_str() {
        "today" => today.format("%Y-%m-%d").to_string(),
        "tomorrow" => (today + chrono::Duration::days(1))
            .format("%Y-%m-%d")
            .to_string(),
        _ => input.to_string(),
    }
}

/// Write the provider discovery file to ~/.slop/providers/tsk.json.
pub fn write_discovery(store: &Arc<Mutex<Store>>, socket_path: &str) {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return,
    };
    let dir = home.join(".slop").join("providers");
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("tsk.json");

    let st = store.lock().unwrap();
    let tasks = st.load();
    let total = tasks.len();
    let pending = tasks.iter().filter(|t| !t.done).count();
    let overdue = tasks
        .iter()
        .filter(|t| {
            let (s, _, _) = compute_salience(t);
            s >= 1.0 && !t.done
        })
        .count();

    let desc = json!({
        "id": "tsk",
        "name": "tsk",
        "version": "0.1.0",
        "slop_version": "0.1",
        "transport": { "type": "unix", "path": socket_path },
        "pid": std::process::id(),
        "capabilities": ["state", "patches", "affordances", "attention"],
        "description": format!("Task manager with {total} tasks ({pending} pending, {overdue} overdue)")
    });

    let _ = fs::write(&path, serde_json::to_string_pretty(&desc).unwrap());
}

/// Remove the discovery file.
pub fn remove_discovery() {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return,
    };
    let path = home.join(".slop").join("providers").join("tsk.json");
    let _ = fs::remove_file(path);
}
