//! Unix domain socket transport using NDJSON (newline-delimited JSON).
//!
//! ```no_run
//! use slop_ai::SlopServer;
//! use slop_ai::transport::unix;
//!
//! #[tokio::main]
//! async fn main() {
//!     let slop = SlopServer::new("my-app", "My App");
//!     let handle = unix::listen(&slop, "/tmp/slop/my-app.sock").await.unwrap();
//!     handle.await.unwrap();
//! }
//! ```

use std::path::Path;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::task::JoinHandle;

use crate::error::{Result, SlopError};
use crate::server::{Connection, SlopServer};

struct NdjsonConnection {
    writer: Mutex<tokio::io::WriteHalf<tokio::net::UnixStream>>,
}

impl Connection for NdjsonConnection {
    fn send(&self, message: &Value) -> Result<()> {
        let mut line = serde_json::to_string(message)?;
        line.push('\n');
        let mut writer = self.writer.lock().map_err(|e| SlopError::Transport(e.to_string()))?;
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                writer
                    .write_all(line.as_bytes())
                    .await
                    .map_err(|e| SlopError::Transport(e.to_string()))
            })
        })
    }

    fn close(&self) -> Result<()> {
        let mut writer = self.writer.lock().map_err(|e| SlopError::Transport(e.to_string()))?;
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                let _ = writer.shutdown().await;
                Ok(())
            })
        })
    }
}

/// Listen for SLOP consumers on a Unix domain socket.
///
/// Returns a `JoinHandle` that resolves when the listener shuts down.
pub async fn listen(slop: &SlopServer, socket_path: &str) -> Result<JoinHandle<()>> {
    // Clean up stale socket
    let _ = std::fs::remove_file(socket_path);
    if let Some(parent) = Path::new(socket_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| SlopError::Transport(e.to_string()))?;
    }

    let listener =
        UnixListener::bind(socket_path).map_err(|e| SlopError::Transport(e.to_string()))?;

    // Set restrictive permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(socket_path, std::fs::Permissions::from_mode(0o600));
    }

    let slop = slop.clone();

    let handle = tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let slop = slop.clone();
            tokio::spawn(async move {
                let (reader, writer) = tokio::io::split(stream);
                let conn: Arc<dyn Connection> = Arc::new(NdjsonConnection {
                    writer: Mutex::new(writer),
                });

                slop.handle_connection(conn.clone());

                let mut lines = BufReader::new(reader).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let line = line.trim().to_string();
                    if line.is_empty() {
                        continue;
                    }
                    if let Ok(msg) = serde_json::from_str::<Value>(&line) {
                        slop.handle_message(&conn, &msg);
                    }
                }

                slop.handle_disconnect(&conn);
            });
        }
    });

    Ok(handle)
}

/// Write a discovery descriptor to `~/.slop/providers/`.
pub fn register_provider(id: &str, name: &str, socket_path: &str) -> Result<()> {
    let home = dirs_home()?;
    let providers_dir = Path::new(&home).join(".slop").join("providers");
    std::fs::create_dir_all(&providers_dir).map_err(|e| SlopError::Transport(e.to_string()))?;

    let descriptor = serde_json::json!({
        "id": id,
        "name": name,
        "slop_version": "0.1",
        "transport": {"type": "unix", "path": socket_path},
        "pid": std::process::id(),
        "capabilities": ["state", "patches", "affordances"]
    });

    let path = providers_dir.join(format!("{id}.json"));
    std::fs::write(&path, serde_json::to_string_pretty(&descriptor)?)
        .map_err(|e| SlopError::Transport(e.to_string()))?;
    Ok(())
}

/// Remove a discovery descriptor from `~/.slop/providers/`.
pub fn unregister_provider(id: &str) -> Result<()> {
    let home = dirs_home()?;
    let path = Path::new(&home)
        .join(".slop")
        .join("providers")
        .join(format!("{id}.json"));
    let _ = std::fs::remove_file(path);
    Ok(())
}

fn dirs_home() -> Result<String> {
    std::env::var("HOME").map_err(|_| SlopError::Transport("HOME not set".into()))
}
