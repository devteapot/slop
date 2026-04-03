mod pomodoro;
mod provider;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use pomodoro::{PomodoroSnapshot, PomodoroState};
use tauri::State;

struct AppState {
    pomodoro: Arc<Mutex<PomodoroState>>,
}

#[tauri::command]
fn get_state(state: State<'_, AppState>) -> PomodoroSnapshot {
    state.pomodoro.lock().unwrap().snapshot()
}

#[tauri::command]
fn timer_start(state: State<'_, AppState>, tag: Option<String>) -> Result<(), String> {
    let mut st = state.pomodoro.lock().unwrap();
    st.start(tag);
    Ok(())
}

#[tauri::command]
fn timer_pause(state: State<'_, AppState>) -> Result<(), String> {
    let mut st = state.pomodoro.lock().unwrap();
    st.pause();
    Ok(())
}

#[tauri::command]
fn timer_resume(state: State<'_, AppState>) -> Result<(), String> {
    let mut st = state.pomodoro.lock().unwrap();
    st.resume();
    Ok(())
}

#[tauri::command]
fn timer_skip(state: State<'_, AppState>) -> Result<(), String> {
    let mut st = state.pomodoro.lock().unwrap();
    st.skip();
    Ok(())
}

#[tauri::command]
fn timer_stop(state: State<'_, AppState>) -> Result<(), String> {
    let mut st = state.pomodoro.lock().unwrap();
    st.stop();
    Ok(())
}

#[tauri::command]
fn timer_tag(state: State<'_, AppState>, label: String) -> Result<(), String> {
    let mut st = state.pomodoro.lock().unwrap();
    st.tag(label);
    Ok(())
}

#[tauri::command]
fn session_tag(state: State<'_, AppState>, id: String, label: String) -> Result<(), String> {
    let mut st = state.pomodoro.lock().unwrap();
    st.tag_session(&id, label);
    Ok(())
}

#[tauri::command]
fn session_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut st = state.pomodoro.lock().unwrap();
    st.delete_session(&id);
    Ok(())
}

fn default_data_path() -> PathBuf {
    std::env::var("POMODORO_FILE")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::home_dir()
                .expect("could not determine home directory")
                .join(".pomodoro")
                .join("sessions.json")
        })
}

fn seed_path() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    let candidates = vec![
        exe.parent().map(|p| p.join("seed.json")),
        Some(PathBuf::from("seed.json")),
        exe.parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .map(|p| p.join("seed.json")),
        // When running with cargo tauri dev, the CWD is the project root
        Some(PathBuf::from("examples/desktop/rust/seed.json")),
    ];
    for c in candidates.into_iter().flatten() {
        if c.exists() {
            return c;
        }
    }
    PathBuf::from("seed.json")
}

fn main() {
    let data_path = default_data_path();

    // Seed if needed
    pomodoro::seed_if_needed(&data_path, &seed_path());

    let pomo_state = Arc::new(Mutex::new(PomodoroState::new(data_path)));

    // Set up SLOP provider
    let slop = provider::setup_provider(pomo_state.clone());

    let sock_path = std::env::var("POMODORO_SOCK")
        .unwrap_or_else(|_| "/tmp/slop/pomodoro.sock".to_string());

    let app_state = AppState {
        pomodoro: pomo_state.clone(),
    };

    // Spawn SLOP socket listener and timer tick in a background tokio runtime
    let pomo_for_tick = pomo_state.clone();
    let slop_for_tick = slop.clone();
    let pomo_for_discovery = pomo_state.clone();
    let sock_for_task = sock_path.clone();

    // Build tokio runtime for SLOP + tick
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");

    // Spawn the socket listener
    let slop_for_listen = slop.clone();
    let sock_for_listen = sock_path.clone();
    rt.spawn(async move {
        match slop_ai::transport::unix::listen(&slop_for_listen, &sock_for_listen).await {
            Ok(handle) => {
                println!("pomodoro: SLOP listening on {}", sock_for_listen);
                let _ = handle.await;
            }
            Err(e) => {
                eprintln!("pomodoro: failed to start SLOP socket: {}", e);
            }
        }
    });

    // Spawn the 1-second timer tick
    rt.spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
        loop {
            interval.tick().await;
            let needs_refresh = {
                let mut st = pomo_for_tick.lock().unwrap();
                let phase_changed = st.tick();
                // Always refresh if timer is running (to update remaining time in tree)
                st.phase != pomodoro::Phase::Idle && !st.paused || phase_changed
            };
            if needs_refresh {
                slop_for_tick.refresh();
                // Update discovery file with current state
                provider::write_discovery(&pomo_for_discovery, &sock_for_task);
            }
        }
    });

    // Write initial discovery
    provider::write_discovery(&pomo_state, &sock_path);

    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            get_state,
            timer_start,
            timer_pause,
            timer_resume,
            timer_skip,
            timer_stop,
            timer_tag,
            session_tag,
            session_delete,
        ])
        .on_window_event(move |_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Clean up on window close
                provider::remove_discovery();
                let _ = std::fs::remove_file("/tmp/slop/pomodoro.sock");
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    // Clean up on exit
    provider::remove_discovery();
    let _ = std::fs::remove_file(&sock_path);
}
