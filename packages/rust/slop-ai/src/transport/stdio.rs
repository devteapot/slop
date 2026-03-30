//! Stdio transport using NDJSON on stdin/stdout.
//!
//! Single consumer. Best for CLI tools and spawned subprocesses.
//!
//! ```no_run
//! use slop_ai::SlopServer;
//! use slop_ai::transport::stdio;
//!
//! #[tokio::main]
//! async fn main() {
//!     let slop = SlopServer::new("my-cli", "My CLI Tool");
//!     stdio::listen(&slop).await.unwrap();
//! }
//! ```

use std::io::Write;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::error::{Result, SlopError};
use crate::server::{Connection, SlopServer};

struct StdioConnection {
    stdout: Mutex<std::io::Stdout>,
}

impl Connection for StdioConnection {
    fn send(&self, message: &Value) -> Result<()> {
        let mut line = serde_json::to_string(message)?;
        line.push('\n');
        let mut stdout = self.stdout.lock().unwrap();
        stdout
            .write_all(line.as_bytes())
            .map_err(|e| SlopError::Transport(e.to_string()))?;
        stdout
            .flush()
            .map_err(|e| SlopError::Transport(e.to_string()))
    }

    fn close(&self) -> Result<()> {
        Ok(())
    }
}

/// Listen on stdin/stdout with NDJSON. Blocks until stdin is closed.
pub async fn listen(slop: &SlopServer) -> Result<()> {
    let conn: Arc<dyn Connection> = Arc::new(StdioConnection {
        stdout: Mutex::new(std::io::stdout()),
    });
    slop.handle_connection(conn.clone());

    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();

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
    Ok(())
}
