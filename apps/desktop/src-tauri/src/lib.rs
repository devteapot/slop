mod bridge;
mod chat;
mod commands;
mod events;
mod llm;
mod provider;
mod workspace;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Resolve app data directory for persistence
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from(".").into());
            let _ = std::fs::create_dir_all(&app_data_dir);

            // Initialize managers
            let workspace_mgr = workspace::WorkspaceManager::new(app_data_dir.clone());
            let provider_registry = provider::ProviderRegistry::new();
            let profile_mgr = llm::profiles::ProfileManager::new(app_data_dir.clone());

            app.manage(workspace_mgr.clone());
            app.manage(provider_registry.clone());
            app.manage(profile_mgr);

            // Initial provider discovery
            {
                let descriptors = provider::discovery::scan_providers();
                let registry = provider_registry.clone();
                tauri::async_runtime::spawn(async move {
                    registry.lock().await.ingest_discovered(descriptors);
                });
            }

            // Start bridge server
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new()
                    .expect("Failed to create Tokio runtime for bridge");
                rt.block_on(async move {
                    bridge::start_bridge_server(app_handle).await;
                });
            });

            // Start periodic workspace save flusher
            let flush_mgr = workspace_mgr.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    flush_mgr.lock().await.flush_if_dirty();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Workspace
            commands::list_workspaces,
            commands::get_workspace,
            commands::create_workspace,
            commands::rename_workspace,
            commands::delete_workspace,
            commands::set_active_workspace,
            // Provider
            commands::list_providers,
            commands::add_manual_provider,
            commands::remove_provider,
            commands::connect_provider,
            commands::disconnect_provider,
            commands::refresh_discovery,
            // Chat
            commands::send_message,
            commands::clear_chat,
            // LLM profiles
            commands::list_profiles,
            commands::get_active_profile,
            commands::add_profile,
            commands::update_profile,
            commands::delete_profile,
            commands::set_active_profile,
            commands::set_model,
            commands::fetch_models,
            // Bridge
            commands::bridge_send,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
