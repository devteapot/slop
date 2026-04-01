use std::path::PathBuf;

use serde_json::Value;

/// Scan discovery directories for SLOP provider descriptor files.
pub fn scan_providers() -> Vec<Value> {
    let mut providers = Vec::new();

    let dirs = discovery_dirs();
    for dir in dirs {
        if !dir.exists() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map_or(false, |ext| ext == "json") {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        if let Ok(val) = serde_json::from_str::<Value>(&content) {
                            providers.push(val);
                        }
                    }
                }
            }
        }
    }

    providers
}

/// Return the directories to watch for provider descriptors.
pub fn discovery_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".slop").join("providers"));
    }

    dirs.push(PathBuf::from("/tmp/slop/providers"));

    dirs
}
