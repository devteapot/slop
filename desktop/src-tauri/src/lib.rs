mod bridge;
mod commands;
mod provider_manager;

use commands::ConnectionStore;
use provider_manager::ProviderStore;
use std::collections::HashMap;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ConnectionStore(Mutex::new(HashMap::new())))
        .manage(ProviderStore(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            commands::list_providers,
            commands::connect_unix,
            commands::send_unix,
            commands::disconnect_unix,
            commands::connect_stdio,
            bridge::bridge_send,
            provider_manager::provider_connect,
            provider_manager::provider_disconnect,
            provider_manager::provider_invoke,
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
