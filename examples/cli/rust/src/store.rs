use std::fs;
use std::path::{Path, PathBuf};

use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: String,
    pub created: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskFile {
    pub tasks: Vec<Task>,
}

pub struct Store {
    pub path: PathBuf,
}

impl Store {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> Vec<Task> {
        if !self.path.exists() {
            return Vec::new();
        }
        let data = fs::read_to_string(&self.path).unwrap_or_default();
        let file: TaskFile = serde_json::from_str(&data).unwrap_or(TaskFile { tasks: Vec::new() });
        file.tasks
    }

    pub fn save(&self, tasks: &[Task]) {
        if let Some(parent) = self.path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let file = TaskFile {
            tasks: tasks.to_vec(),
        };
        let json = serde_json::to_string_pretty(&file).expect("serialize tasks");
        fs::write(&self.path, json).expect("write tasks file");
    }

    pub fn next_id(&self, tasks: &[Task]) -> String {
        let max = tasks
            .iter()
            .filter_map(|t| t.id.strip_prefix("t-").and_then(|n| n.parse::<u32>().ok()))
            .max()
            .unwrap_or(0);
        format!("t-{}", max + 1)
    }

    /// Seed from a JSON file if the data file doesn't exist yet.
    pub fn seed_if_needed(&self, seed_path: &Path) {
        if self.path.exists() {
            return;
        }
        if seed_path.exists() {
            if let Some(parent) = self.path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::copy(seed_path, &self.path);
        }
    }
}

/// Compute salience for a task based on its due date and completion status.
pub fn compute_salience(task: &Task) -> (f64, Option<String>, Option<String>) {
    if task.done {
        return (0.2, None, None);
    }

    let today = Utc::now().date_naive();

    match &task.due {
        None => (0.4, None, None),
        Some(due_str) => {
            let due = match NaiveDate::parse_from_str(due_str, "%Y-%m-%d") {
                Ok(d) => d,
                Err(_) => return (0.4, None, None),
            };

            let days_until = (due - today).num_days();

            if days_until < 0 {
                let overdue_days = -days_until;
                (
                    1.0,
                    Some("high".to_string()),
                    Some(format!(
                        "{} day{} overdue",
                        overdue_days,
                        if overdue_days == 1 { "" } else { "s" }
                    )),
                )
            } else if days_until == 0 {
                (0.9, Some("medium".to_string()), Some("due today".to_string()))
            } else if days_until <= 7 {
                (0.7, Some("low".to_string()), Some(format!("due in {} days", days_until)))
            } else {
                (0.5, None, Some(format!("due in {} days", days_until)))
            }
        }
    }
}

/// Build a content ref descriptor for a task's notes.
pub fn content_ref_for(task: &Task) -> serde_json::Value {
    if task.notes.is_empty() {
        serde_json::json!({
            "type": "text",
            "mime": "text/plain",
            "summary": "No notes",
        })
    } else {
        let lines = task.notes.lines().count();
        let size = task.notes.len();
        let preview = if task.notes.len() > 100 {
            format!("{}...", &task.notes[..97])
        } else {
            task.notes.clone()
        };
        serde_json::json!({
            "type": "text",
            "mime": "text/plain",
            "size": size,
            "summary": format!("{} line{} of notes", lines, if lines == 1 { "" } else { "s" }),
            "preview": preview,
        })
    }
}
