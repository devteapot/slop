use std::collections::HashMap;
use std::fs;
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::Mutex;

// --- Connection state ---

pub struct UnixConnection {
    writer: Arc<Mutex<tokio::io::WriteHalf<UnixStream>>>,
    abort_handle: tokio::task::AbortHandle,
}

pub struct ConnectionStore(pub Mutex<HashMap<String, UnixConnection>>);

// --- Discovery ---

#[tauri::command]
pub fn list_providers() -> Result<Vec<Value>, String> {
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
                Ok(content) => match serde_json::from_str::<Value>(&content) {
                    Ok(val) => providers.push(val),
                    Err(e) => eprintln!("Failed to parse {:?}: {}", path, e),
                },
                Err(e) => eprintln!("Failed to read {:?}: {}", path, e),
            }
        }
    }

    Ok(providers)
}

// --- Unix socket connection ---

#[tauri::command]
pub async fn connect_unix(
    app: AppHandle,
    socket_path: String,
    conn_id: String,
) -> Result<String, String> {
    let stream = UnixStream::connect(&socket_path)
        .await
        .map_err(|e| format!("Failed to connect to {}: {}", socket_path, e))?;
    let (reader, writer) = tokio::io::split(stream);
    let writer = Arc::new(Mutex::new(writer));

    // Spawn reader task: reads NDJSON lines → emits Tauri events
    let event_name = format!("slop-message-{}", conn_id);
    let conn_id_clone = conn_id.clone();
    let app_clone = app.clone();
    let reader_task = tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.is_empty() {
                continue;
            }
            if let Ok(msg) = serde_json::from_str::<Value>(&line) {
                let _ = app_clone.emit(&event_name, msg);
            }
        }
        // Connection closed — notify JS
        let _ = app_clone.emit(
            &format!("slop-closed-{}", conn_id_clone),
            (),
        );
    });

    let store = app.state::<ConnectionStore>();
    store.0.lock().await.insert(
        conn_id.clone(),
        UnixConnection {
            writer,
            abort_handle: reader_task.abort_handle(),
        },
    );

    Ok(conn_id)
}

#[tauri::command]
pub async fn send_unix(
    app: AppHandle,
    conn_id: String,
    message: Value,
) -> Result<(), String> {
    let store = app.state::<ConnectionStore>();
    let connections = store.0.lock().await;
    let conn = connections
        .get(&conn_id)
        .ok_or_else(|| format!("Connection {} not found", conn_id))?;

    let mut line = serde_json::to_string(&message).map_err(|e| e.to_string())?;
    line.push('\n');

    conn.writer
        .lock()
        .await
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("Write failed: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn disconnect_unix(app: AppHandle, conn_id: String) -> Result<(), String> {
    let store = app.state::<ConnectionStore>();
    let mut connections = store.0.lock().await;
    if let Some(conn) = connections.remove(&conn_id) {
        conn.abort_handle.abort();
        let mut w = conn.writer.lock().await;
        let _ = w.shutdown().await;
    }
    Ok(())
}

// --- Stubs ---

#[tauri::command]
pub fn connect_stdio(_command: Vec<String>) -> Result<String, String> {
    Err("Stdio transport not yet implemented".into())
}
