use std::sync::{Arc, Mutex};

use chrono::Utc;

use crate::store::{compute_salience, Store, Task};

/// List tasks (pending by default, or all/filtered by tag).
pub fn cmd_list(store: &Arc<Mutex<Store>>, all: bool, tag: Option<&str>) {
    let s = store.lock().unwrap();
    let tasks = s.load();

    let mut filtered: Vec<&Task> = tasks
        .iter()
        .filter(|t| {
            if !all && t.done {
                return false;
            }
            if let Some(tag) = tag {
                return t.tags.iter().any(|tt| tt == tag);
            }
            true
        })
        .collect();

    // Sort by salience descending
    filtered.sort_by(|a, b| {
        let (sa, _, _) = compute_salience(a);
        let (sb, _, _) = compute_salience(b);
        sb.partial_cmp(&sa).unwrap_or(std::cmp::Ordering::Equal)
    });

    if filtered.is_empty() {
        println!("No tasks found.");
        return;
    }

    for t in &filtered {
        let check = if t.done { "x" } else { " " };
        let num: &str = t.id.strip_prefix("t-").unwrap_or(&t.id);
        let due_info = if t.done {
            t.completed_at
                .as_deref()
                .map(|_| "done".to_string())
                .unwrap_or_default()
        } else {
            t.due
                .as_deref()
                .map(|d| format!("due: {d}"))
                .unwrap_or_default()
        };
        let tags = t.tags.iter().map(|t| format!("#{t}")).collect::<Vec<_>>().join(" ");
        println!(
            "  \x1b[1m{num:>2}\x1b[0m. [{check}] {title:<30} {due:<20} {tags}",
            title = t.title,
            due = due_info,
            tags = tags,
        );
    }
}

/// Add a new task.
pub fn cmd_add(store: &Arc<Mutex<Store>>, title: &str, due: Option<&str>, tag: Option<&str>) {
    let s = store.lock().unwrap();
    let mut tasks = s.load();
    let id = s.next_id(&tasks);

    let tags = tag
        .map(|t| t.split(',').map(|s| s.trim().to_string()).collect())
        .unwrap_or_default();

    tasks.push(Task {
        id: id.clone(),
        title: title.to_string(),
        done: false,
        due: due.map(|d| resolve_date(d)),
        tags,
        notes: String::new(),
        created: Utc::now().to_rfc3339(),
        completed_at: None,
    });

    s.save(&tasks);
    let num = id.strip_prefix("t-").unwrap_or(&id);
    println!("Created task #{num}");
}

/// Mark a task as done.
pub fn cmd_done(store: &Arc<Mutex<Store>>, id_num: &str) {
    let s = store.lock().unwrap();
    let mut tasks = s.load();
    let id = normalize_id(id_num);

    if let Some(task) = tasks.iter_mut().find(|t| t.id == id) {
        task.done = true;
        task.completed_at = Some(Utc::now().to_rfc3339());
        println!("Completed: {}", task.title);
        s.save(&tasks);
    } else {
        eprintln!("Task {id} not found");
    }
}

/// Mark a task as incomplete.
pub fn cmd_undo(store: &Arc<Mutex<Store>>, id_num: &str) {
    let s = store.lock().unwrap();
    let mut tasks = s.load();
    let id = normalize_id(id_num);

    if let Some(task) = tasks.iter_mut().find(|t| t.id == id) {
        task.done = false;
        task.completed_at = None;
        println!("Reopened: {}", task.title);
        s.save(&tasks);
    } else {
        eprintln!("Task {id} not found");
    }
}

/// Edit a task's fields.
pub fn cmd_edit(
    store: &Arc<Mutex<Store>>,
    id_num: &str,
    title: Option<&str>,
    due: Option<&str>,
    tag: Option<&str>,
) {
    let s = store.lock().unwrap();
    let mut tasks = s.load();
    let id = normalize_id(id_num);

    if let Some(task) = tasks.iter_mut().find(|t| t.id == id) {
        if let Some(t) = title {
            task.title = t.to_string();
        }
        if let Some(d) = due {
            task.due = Some(resolve_date(d));
        }
        if let Some(tg) = tag {
            task.tags = tg.split(',').map(|s| s.trim().to_string()).collect();
        }
        println!("Updated: {}", task.title);
        s.save(&tasks);
    } else {
        eprintln!("Task {id} not found");
    }
}

/// Delete a task.
pub fn cmd_delete(store: &Arc<Mutex<Store>>, id_num: &str) {
    let s = store.lock().unwrap();
    let mut tasks = s.load();
    let id = normalize_id(id_num);
    let len_before = tasks.len();
    tasks.retain(|t| t.id != id);

    if tasks.len() < len_before {
        println!("Deleted task {id}");
        s.save(&tasks);
    } else {
        eprintln!("Task {id} not found");
    }
}

/// Show or set notes.
pub fn cmd_notes(store: &Arc<Mutex<Store>>, id_num: &str, set_text: Option<&str>) {
    let s = store.lock().unwrap();
    let mut tasks = s.load();
    let id = normalize_id(id_num);

    if let Some(idx) = tasks.iter().position(|t| t.id == id) {
        if let Some(text) = set_text {
            tasks[idx].notes = text.to_string();
            let title = tasks[idx].title.clone();
            s.save(&tasks);
            println!("Notes updated for {}", title);
        } else if tasks[idx].notes.is_empty() {
            println!("No notes for: {}", tasks[idx].title);
        } else {
            println!("{}", tasks[idx].notes);
        }
    } else {
        eprintln!("Task {id} not found");
    }
}

/// Search tasks by title or tag.
pub fn cmd_search(store: &Arc<Mutex<Store>>, query: &str) {
    let s = store.lock().unwrap();
    let tasks = s.load();
    let q = query.to_lowercase();

    let matches: Vec<&Task> = tasks
        .iter()
        .filter(|t| {
            t.title.to_lowercase().contains(&q)
                || t.tags.iter().any(|tag| tag.to_lowercase().contains(&q))
        })
        .collect();

    if matches.is_empty() {
        println!("No tasks matching \"{query}\"");
        return;
    }

    for t in &matches {
        let check = if t.done { "x" } else { " " };
        let num = t.id.strip_prefix("t-").unwrap_or(&t.id);
        let tags = t.tags.iter().map(|t| format!("#{t}")).collect::<Vec<_>>().join(" ");
        println!("  {num:>2}. [{check}] {:<30} {tags}", t.title);
    }
}

/// Export tasks in the given format.
pub fn cmd_export(store: &Arc<Mutex<Store>>, format: &str) {
    let s = store.lock().unwrap();
    let tasks = s.load();

    match format {
        "json" => {
            println!("{}", serde_json::to_string_pretty(&tasks).unwrap());
        }
        "csv" => {
            println!("id,title,done,due,tags");
            for t in &tasks {
                let tags = t.tags.join(";");
                let due = t.due.as_deref().unwrap_or("");
                println!("{},{},{},{},{}", t.id, t.title, t.done, due, tags);
            }
        }
        "markdown" => {
            println!("# Tasks\n");
            for t in &tasks {
                let check = if t.done { "x" } else { " " };
                let due = t.due.as_deref().map(|d| format!(" (due: {d})")).unwrap_or_default();
                println!("- [{check}] {}{due}", t.title);
            }
        }
        _ => {
            eprintln!("Unknown format: {format}. Use json, csv, or markdown.");
        }
    }
}

fn normalize_id(id: &str) -> String {
    if id.starts_with("t-") {
        id.to_string()
    } else {
        format!("t-{id}")
    }
}

fn resolve_date(input: &str) -> String {
    let today = chrono::Utc::now().date_naive();
    match input.to_lowercase().as_str() {
        "today" => today.format("%Y-%m-%d").to_string(),
        "tomorrow" => (today + chrono::Duration::days(1))
            .format("%Y-%m-%d")
            .to_string(),
        _ => input.to_string(), // assume ISO date
    }
}
