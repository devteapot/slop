mod bridge;
mod commands;

use commands::ConnectionStore;
use std::collections::HashMap;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ConnectionStore(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            commands::list_providers,
            commands::connect_unix,
            commands::send_unix,
            commands::disconnect_unix,
            commands::connect_stdio,
            bridge::bridge_send,
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime for bridge");
                rt.block_on(async move {
                    bridge::start_bridge_server(app_handle).await;
                });
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
