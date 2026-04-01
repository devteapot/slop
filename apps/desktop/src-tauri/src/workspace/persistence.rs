use std::path::PathBuf;

use crate::workspace::Workspace;

pub fn workspaces_path(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("workspaces.json")
}

pub fn load_workspaces(app_data_dir: &PathBuf) -> Vec<Workspace> {
    let path = workspaces_path(app_data_dir);
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub fn save_workspaces(app_data_dir: &PathBuf, workspaces: &[Workspace]) {
    let path = workspaces_path(app_data_dir);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(workspaces) {
        let _ = std::fs::write(&path, json);
    }
}
