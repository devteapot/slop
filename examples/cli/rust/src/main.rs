mod cli;
mod provider;
mod store;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use store::Store;

fn default_data_path() -> PathBuf {
    dirs::home_dir()
        .expect("could not determine home directory")
        .join(".tsk")
        .join("tasks.json")
}

fn seed_path() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    // Look for seed.json next to the binary, or relative to CWD
    let candidates = vec![
        exe.parent().map(|p| p.join("seed.json")),
        Some(PathBuf::from("seed.json")),
        exe.parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .map(|p| p.join("seed.json")),
    ];
    for c in candidates.into_iter().flatten() {
        if c.exists() {
            return c;
        }
    }
    PathBuf::from("seed.json")
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // Parse --file and --slop flags
    let mut file_path: Option<PathBuf> = None;
    let mut slop_mode = false;
    let mut sock_path: Option<String> = None;
    let mut positional: Vec<String> = Vec::new();
    let mut i = 1;

    while i < args.len() {
        match args[i].as_str() {
            "--slop" => {
                slop_mode = true;
            }
            "--file" => {
                i += 1;
                if i < args.len() {
                    file_path = Some(PathBuf::from(&args[i]));
                }
            }
            "--sock" => {
                i += 1;
                if i < args.len() {
                    sock_path = Some(args[i].clone());
                }
            }
            _ => {
                positional.push(args[i].clone());
            }
        }
        i += 1;
    }

    let data_path = file_path
        .or_else(|| std::env::var("TSK_FILE").ok().map(PathBuf::from))
        .unwrap_or_else(default_data_path);

    let store = Arc::new(Mutex::new(Store::new(data_path)));

    // Seed data if needed
    store.lock().unwrap().seed_if_needed(&seed_path());

    if slop_mode {
        let sock = sock_path
            .or_else(|| std::env::var("TSK_SOCK").ok())
            .unwrap_or_else(|| "/tmp/slop/tsk.sock".to_string());
        run_slop(store, &sock);
    } else {
        run_cli(store, &positional);
    }
}

fn run_cli(store: Arc<Mutex<Store>>, args: &[String]) {
    if args.is_empty() {
        cli::cmd_list(&store, false, None);
        return;
    }

    match args[0].as_str() {
        "list" => {
            let all = args.iter().any(|a| a == "--all");
            let tag = args
                .iter()
                .position(|a| a == "--tag")
                .and_then(|i| args.get(i + 1));
            cli::cmd_list(&store, all, tag.map(|s| s.as_str()));
        }
        "add" => {
            let title = args.get(1).map(|s| s.as_str()).unwrap_or("");
            if title.is_empty() {
                eprintln!("Usage: tsk add <title> [--due <date>] [--tag <tag>]");
                return;
            }
            let due = args
                .iter()
                .position(|a| a == "--due")
                .and_then(|i| args.get(i + 1));
            let tag = args
                .iter()
                .position(|a| a == "--tag")
                .and_then(|i| args.get(i + 1));
            cli::cmd_add(&store, title, due.map(|s| s.as_str()), tag.map(|s| s.as_str()));
        }
        "done" => {
            let id = args.get(1).map(|s| s.as_str()).unwrap_or("");
            if id.is_empty() {
                eprintln!("Usage: tsk done <id>");
                return;
            }
            cli::cmd_done(&store, id);
        }
        "undo" => {
            let id = args.get(1).map(|s| s.as_str()).unwrap_or("");
            if id.is_empty() {
                eprintln!("Usage: tsk undo <id>");
                return;
            }
            cli::cmd_undo(&store, id);
        }
        "edit" => {
            let id = args.get(1).map(|s| s.as_str()).unwrap_or("");
            if id.is_empty() {
                eprintln!("Usage: tsk edit <id> [--title <t>] [--due <d>] [--tag <t>]");
                return;
            }
            let title = args
                .iter()
                .position(|a| a == "--title")
                .and_then(|i| args.get(i + 1));
            let due = args
                .iter()
                .position(|a| a == "--due")
                .and_then(|i| args.get(i + 1));
            let tag = args
                .iter()
                .position(|a| a == "--tag")
                .and_then(|i| args.get(i + 1));
            cli::cmd_edit(
                &store,
                id,
                title.map(|s| s.as_str()),
                due.map(|s| s.as_str()),
                tag.map(|s| s.as_str()),
            );
        }
        "delete" => {
            let id = args.get(1).map(|s| s.as_str()).unwrap_or("");
            if id.is_empty() {
                eprintln!("Usage: tsk delete <id>");
                return;
            }
            cli::cmd_delete(&store, id);
        }
        "notes" => {
            let id = args.get(1).map(|s| s.as_str()).unwrap_or("");
            if id.is_empty() {
                eprintln!("Usage: tsk notes <id> [--set <text>]");
                return;
            }
            let set_text = args
                .iter()
                .position(|a| a == "--set")
                .and_then(|i| args.get(i + 1));
            cli::cmd_notes(&store, id, set_text.map(|s| s.as_str()));
        }
        "search" => {
            let query = args.get(1).map(|s| s.as_str()).unwrap_or("");
            if query.is_empty() {
                eprintln!("Usage: tsk search <query>");
                return;
            }
            cli::cmd_search(&store, query);
        }
        "export" => {
            let format = args.get(1).map(|s| s.as_str()).unwrap_or("json");
            cli::cmd_export(&store, format);
        }
        _ => {
            eprintln!("Unknown command: {}. Try: list, add, done, undo, edit, delete, notes, search, export", args[0]);
        }
    }
}

fn run_slop(store: Arc<Mutex<Store>>, sock_path: &str) {
    let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
    let sock = sock_path.to_string();
    rt.block_on(async {
        let slop = provider::setup_provider(store.clone());

        // Write discovery file
        provider::write_discovery(&store, &sock);

        // Clean up discovery on exit
        let _guard = DiscoveryGuard;

        // Print status to stdout
        {
            let st = store.lock().unwrap();
            let tasks = st.load();
            let total = tasks.len();
            let pending = tasks.iter().filter(|t| !t.done).count();
            let overdue = tasks.iter().filter(|t| {
                let (s, _, _) = crate::store::compute_salience(t);
                s >= 1.0 && !t.done
            }).count();
            println!("tsk: listening on {}", sock);
            println!("tsk: {} tasks loaded ({} pending, {} overdue)", total, pending, overdue);
        }

        // Listen on Unix socket
        let handle = slop_ai::transport::unix::listen(&slop, &sock).await.unwrap();
        handle.await.unwrap();
    });
}

/// RAII guard that removes the discovery file when dropped.
struct DiscoveryGuard;

impl Drop for DiscoveryGuard {
    fn drop(&mut self) {
        provider::remove_discovery();
    }
}
