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
use std::sync::Arc;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::error::{Result, SlopError};
use crate::server::{Connection, SlopServer};

enum ConnMessage {
    Send(Value),
    Close,
}

struct ChannelConnection {
    tx: mpsc::UnboundedSender<ConnMessage>,
}

impl Connection for ChannelConnection {
    fn send(&self, message: &Value) -> Result<()> {
        self.tx
            .send(ConnMessage::Send(message.clone()))
            .map_err(|_| SlopError::Transport("connection closed".into()))
    }

    fn close(&self) -> Result<()> {
        let _ = self.tx.send(ConnMessage::Close);
        Ok(())
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
                let (reader, mut writer) = tokio::io::split(stream);
                let (tx, mut rx) = mpsc::unbounded_channel::<ConnMessage>();
                let conn: Arc<dyn Connection> = Arc::new(ChannelConnection { tx });

                // Spawn a writer task that drains the channel into the Unix socket
                tokio::spawn(async move {
                    while let Some(msg) = rx.recv().await {
                        match msg {
                            ConnMessage::Send(val) => {
                                let mut line = serde_json::to_string(&val).unwrap_or_default();
                                line.push('\n');
                                if writer.write_all(line.as_bytes()).await.is_err() {
                                    break;
                                }
                            }
                            ConnMessage::Close => {
                                let _ = writer.shutdown().await;
                                break;
                            }
                        }
                    }
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

/// Check whether `id` is a valid descriptor filename stem.
/// See spec/core/transport.md §Local discovery.
fn is_valid_descriptor_stem(id: &str) -> bool {
    let len = id.len();
    if len == 0 || len > 64 {
        return false;
    }
    let bytes = id.as_bytes();
    if !(bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit()) {
        return false;
    }
    bytes
        .iter()
        .all(|&b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'_' || b == b'-')
}

/// Write a discovery descriptor to `~/.slop/providers/`.
///
/// The providers directory is created with mode 0700 and the descriptor is
/// written atomically (write to a same-directory temp file, then rename) with
/// mode 0600. See spec/core/transport.md §Local discovery.
pub fn register_provider(id: &str, name: &str, socket_path: &str) -> Result<()> {
    if !is_valid_descriptor_stem(id) {
        return Err(SlopError::Transport(format!(
            "provider id {id:?} is not a valid descriptor filename stem",
        )));
    }
    let home = dirs_home()?;
    let providers_dir = Path::new(&home).join(".slop").join("providers");
    std::fs::create_dir_all(&providers_dir).map_err(|e| SlopError::Transport(e.to_string()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&providers_dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| SlopError::Transport(e.to_string()))?;
    }

    let descriptor = serde_json::json!({
        "id": id,
        "name": name,
        "slop_version": "0.1",
        "transport": {"type": "unix", "path": socket_path},
        "pid": std::process::id(),
        "capabilities": ["state", "patches", "affordances", "attention", "windowing", "async", "content_refs"]
    });

    let final_path = providers_dir.join(format!("{id}.json"));
    let tmp_path = providers_dir.join(format!("{id}.json.tmp.{}", std::process::id()));
    std::fs::write(&tmp_path, serde_json::to_string_pretty(&descriptor)?)
        .map_err(|e| SlopError::Transport(e.to_string()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o600))
        {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(SlopError::Transport(e.to_string()));
        }
    }

    std::fs::rename(&tmp_path, &final_path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        SlopError::Transport(e.to_string())
    })?;
    Ok(())
}

/// Remove a discovery descriptor from `~/.slop/providers/`.
pub fn unregister_provider(id: &str) -> Result<()> {
    if !is_valid_descriptor_stem(id) {
        return Ok(());
    }
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
