use std::fs;

#[tauri::command]
pub fn list_providers() -> Result<Vec<serde_json::Value>, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let providers_dir = home.join(".slop").join("providers");

    if !providers_dir.exists() {
        return Ok(vec![]);
    }

    let mut providers = vec![];
    let entries = fs::read_dir(&providers_dir).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "json") {
            match fs::read_to_string(&path) {
                Ok(content) => match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(val) => providers.push(val),
                    Err(e) => eprintln!("Failed to parse {:?}: {}", path, e),
                },
                Err(e) => eprintln!("Failed to read {:?}: {}", path, e),
            }
        }
    }

    Ok(providers)
}

#[tauri::command]
pub fn connect_unix(_socket_path: String) -> Result<String, String> {
    Err("Unix socket transport not yet implemented".into())
}

#[tauri::command]
pub fn connect_stdio(_command: Vec<String>) -> Result<String, String> {
    Err("Stdio transport not yet implemented".into())
}
