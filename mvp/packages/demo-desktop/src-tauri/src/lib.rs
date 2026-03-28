mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::list_providers,
            commands::connect_unix,
            commands::connect_stdio,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
