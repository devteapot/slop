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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
