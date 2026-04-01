use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

use crate::bridge;
use crate::chat::types::UiMessage;
use crate::events;
use crate::llm;
use crate::llm::profiles::{LlmProfile, ProfileManager};
use crate::provider::{self, ProviderRegistry, ProviderSummary, TransportConfig};
use crate::workspace::{WorkspaceDetail, WorkspaceManager, WorkspaceSummary};

// ========================================================================
// Workspace commands
// ========================================================================

#[tauri::command]
pub async fn list_workspaces(
    manager: State<'_, Arc<Mutex<WorkspaceManager>>>,
) -> Result<Vec<WorkspaceSummary>, String> {
    Ok(manager.lock().await.list_summaries())
}

#[tauri::command]
pub async fn get_workspace(
    manager: State<'_, Arc<Mutex<WorkspaceManager>>>,
    workspace_id: String,
) -> Result<WorkspaceDetail, String> {
    let mgr = manager.lock().await;
    mgr.get_workspace(&workspace_id)
        .map(WorkspaceDetail::from)
        .ok_or_else(|| format!("Workspace {} not found", workspace_id))
}

#[tauri::command]
pub async fn create_workspace(
    app: AppHandle,
    manager: State<'_, Arc<Mutex<WorkspaceManager>>>,
    name: String,
) -> Result<WorkspaceSummary, String> {
    let mut mgr = manager.lock().await;
    let summary = mgr.create_workspace(&name);
    events::emit_workspaces_changed(&app, mgr.list_summaries());
    Ok(summary)
}

#[tauri::command]
pub async fn rename_workspace(
    app: AppHandle,
    manager: State<'_, Arc<Mutex<WorkspaceManager>>>,
    workspace_id: String,
    name: String,
) -> Result<(), String> {
    let mut mgr = manager.lock().await;
    mgr.rename_workspace(&workspace_id, &name);
    events::emit_workspaces_changed(&app, mgr.list_summaries());
    Ok(())
}

#[tauri::command]
pub async fn delete_workspace(
    app: AppHandle,
    manager: State<'_, Arc<Mutex<WorkspaceManager>>>,
    workspace_id: String,
) -> Result<(), String> {
    let mut mgr = manager.lock().await;
    mgr.delete_workspace(&workspace_id);
    events::emit_workspaces_changed(&app, mgr.list_summaries());
    Ok(())
}

#[tauri::command]
pub async fn set_active_workspace(
    app: AppHandle,
    manager: State<'_, Arc<Mutex<WorkspaceManager>>>,
    registry: State<'_, Arc<Mutex<ProviderRegistry>>>,
    workspace_id: String,
) -> Result<(), String> {
    let switch_info = {
        let mut mgr = manager.lock().await;
        mgr.set_active_workspace(&workspace_id)
    };

    if let Some((old_ids, new_ids)) = switch_info {
        // Disconnect providers not in new workspace
        for id in &old_ids {
            if !new_ids.contains(id) {
                provider::disconnect_provider(&*registry, id).await;
            }
        }
        // Connect providers in new workspace that aren't already connected
        for id in &new_ids {
            if !old_ids.contains(id) {
                let _ = provider::connect_provider(&app, &*registry, id).await;
            }
        }
    }

    Ok(())
}

// ========================================================================
// Provider commands
// ========================================================================

#[tauri::command]
pub async fn list_providers(
    registry: State<'_, Arc<Mutex<ProviderRegistry>>>,
) -> Result<Vec<ProviderSummary>, String> {
    Ok(registry.lock().await.list_summaries())
}

#[tauri::command]
pub async fn add_manual_provider(
    app: AppHandle,
    registry: State<'_, Arc<Mutex<ProviderRegistry>>>,
    url: String,
    name: Option<String>,
) -> Result<ProviderSummary, String> {
    let id = format!("manual-{}", uuid::Uuid::new_v4());
    let entry = provider::ProviderEntry {
        id: id.clone(),
        name: name.unwrap_or_else(|| url.clone()),
        transport: TransportConfig::Ws { url },
        source: provider::ProviderSource::Manual,
        status: provider::ConnectionStatus::Disconnected,
        provider_name: None,
        bridge_tab_id: None,
    };
    let summary = ProviderSummary::from(&entry);
    registry.lock().await.add_entry(entry);
    events::emit_provider_discovered(&app, summary.clone());
    Ok(summary)
}

#[tauri::command]
pub async fn remove_provider(
    app: AppHandle,
    registry: State<'_, Arc<Mutex<ProviderRegistry>>>,
    provider_id: String,
) -> Result<(), String> {
    let mut reg = registry.lock().await;
    if let Some(conn) = reg.connections.remove(&provider_id) {
        conn.consumer.disconnect().await;
    }
    reg.remove_entry(&provider_id);
    events::emit_provider_removed(&app, provider_id);
    Ok(())
}

#[tauri::command]
pub async fn connect_provider(
    app: AppHandle,
    manager: State<'_, Arc<Mutex<WorkspaceManager>>>,
    registry: State<'_, Arc<Mutex<ProviderRegistry>>>,
    provider_id: String,
    workspace_id: String,
) -> Result<(), String> {
    // Emit "connecting" status immediately
    events::emit_provider_status(
        &app,
        events::ProviderStatusPayload {
            provider_id: provider_id.clone(),
            status: "connecting".to_string(),
            provider_name: None,
            tree: None,
            message: None,
        },
    );

    let registry_clone = Arc::clone(&*registry);
    let manager_clone = Arc::clone(&*manager);
    let app_clone = app.clone();

    // Run connection in background — don't block the command
    tokio::spawn(async move {
        match provider::connect_provider(&app_clone, &registry_clone, &provider_id).await {
            Ok(result) => {
                manager_clone
                    .lock()
                    .await
                    .add_provider_to_workspace(&workspace_id, &provider_id);

                events::emit_provider_status(
                    &app_clone,
                    events::ProviderStatusPayload {
                        provider_id,
                        status: "connected".to_string(),
                        provider_name: Some(result.provider_name),
                        tree: Some(result.tree),
                        message: None,
                    },
                );
            }
            Err(e) => {
                events::emit_provider_status(
                    &app_clone,
                    events::ProviderStatusPayload {
                        provider_id,
                        status: "error".to_string(),
                        provider_name: None,
                        tree: None,
                        message: Some(e),
                    },
                );
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn disconnect_provider(
    app: AppHandle,
    manager: State<'_, Arc<Mutex<WorkspaceManager>>>,
    registry: State<'_, Arc<Mutex<ProviderRegistry>>>,
    provider_id: String,
    workspace_id: String,
) -> Result<(), String> {
    provider::disconnect_provider(&*registry, &provider_id).await;

    manager
        .lock()
        .await
        .remove_provider_from_workspace(&workspace_id, &provider_id);

    events::emit_provider_status(
        &app,
        events::ProviderStatusPayload {
            provider_id,
            status: "disconnected".to_string(),
            provider_name: None,
            tree: None,
            message: None,
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn refresh_discovery(
    app: AppHandle,
    registry: State<'_, Arc<Mutex<ProviderRegistry>>>,
) -> Result<Vec<ProviderSummary>, String> {
    let descriptors = provider::discovery::scan_providers();
    let mut reg = registry.lock().await;
    reg.ingest_discovered(descriptors);
    let summaries = reg.list_summaries();
    for s in &summaries {
        events::emit_provider_discovered(&app, s.clone());
    }
    Ok(summaries)
}

// ========================================================================
// Chat commands
// ========================================================================

#[tauri::command]
pub async fn send_message(
    app: AppHandle,
    manager: State<'_, Arc<Mutex<WorkspaceManager>>>,
    registry: State<'_, Arc<Mutex<ProviderRegistry>>>,
    profiles: State<'_, Arc<Mutex<ProfileManager>>>,
    workspace_id: String,
    text: String,
) -> Result<(), String> {
    let profile = profiles.lock().await.get_active_profile();
    let manager_clone = Arc::clone(&*manager);
    let registry_clone = Arc::clone(&*registry);

    // Run the chat turn in a background task
    let app_clone = app.clone();
    tokio::spawn(async move {
        if let Err(e) = crate::chat::ChatEngine::run_turn(
            &app_clone,
            &manager_clone,
            &registry_clone,
            &workspace_id,
            &text,
            &profile,
        )
        .await
        {
            events::emit_chat_message(
                &app_clone,
                &workspace_id,
                UiMessage::new("error", &e),
            );
            events::emit_chat_processing(&app_clone, &workspace_id, false);
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn clear_chat(
    app: AppHandle,
    manager: State<'_, Arc<Mutex<WorkspaceManager>>>,
    workspace_id: String,
) -> Result<(), String> {
    manager.lock().await.clear_chat(&workspace_id);
    // Emit empty messages to clear the UI
    events::emit_workspaces_changed(&app, manager.lock().await.list_summaries());
    Ok(())
}

// ========================================================================
// LLM profile commands
// ========================================================================

#[tauri::command]
pub async fn list_profiles(
    profiles: State<'_, Arc<Mutex<ProfileManager>>>,
) -> Result<Vec<LlmProfile>, String> {
    Ok(profiles.lock().await.list_profiles())
}

#[tauri::command]
pub async fn get_active_profile(
    profiles: State<'_, Arc<Mutex<ProfileManager>>>,
) -> Result<LlmProfile, String> {
    Ok(profiles.lock().await.get_active_profile())
}

#[tauri::command]
pub async fn add_profile(
    app: AppHandle,
    profiles: State<'_, Arc<Mutex<ProfileManager>>>,
    profile: LlmProfile,
) -> Result<(), String> {
    let mut mgr = profiles.lock().await;
    mgr.add_profile(profile);
    events::emit_profiles_changed(&app, mgr.list_profiles(), mgr.active_profile_id().to_string());
    Ok(())
}

#[tauri::command]
pub async fn update_profile(
    app: AppHandle,
    profiles: State<'_, Arc<Mutex<ProfileManager>>>,
    id: String,
    updates: Value,
) -> Result<(), String> {
    let mut mgr = profiles.lock().await;
    mgr.update_profile(&id, updates);
    events::emit_profiles_changed(&app, mgr.list_profiles(), mgr.active_profile_id().to_string());
    Ok(())
}

#[tauri::command]
pub async fn delete_profile(
    app: AppHandle,
    profiles: State<'_, Arc<Mutex<ProfileManager>>>,
    id: String,
) -> Result<(), String> {
    let mut mgr = profiles.lock().await;
    mgr.delete_profile(&id);
    events::emit_profiles_changed(&app, mgr.list_profiles(), mgr.active_profile_id().to_string());
    Ok(())
}

#[tauri::command]
pub async fn set_active_profile(
    app: AppHandle,
    profiles: State<'_, Arc<Mutex<ProfileManager>>>,
    id: String,
) -> Result<(), String> {
    let mut mgr = profiles.lock().await;
    mgr.set_active_profile(&id);
    events::emit_profiles_changed(&app, mgr.list_profiles(), mgr.active_profile_id().to_string());
    Ok(())
}

#[tauri::command]
pub async fn set_model(
    app: AppHandle,
    profiles: State<'_, Arc<Mutex<ProfileManager>>>,
    model: String,
) -> Result<(), String> {
    let mut mgr = profiles.lock().await;
    mgr.set_model(&model);
    events::emit_profiles_changed(&app, mgr.list_profiles(), mgr.active_profile_id().to_string());
    Ok(())
}

#[tauri::command]
pub async fn fetch_models(
    profiles: State<'_, Arc<Mutex<ProfileManager>>>,
) -> Result<Vec<String>, String> {
    let profile = profiles.lock().await.get_active_profile();
    let client = llm::get_client(&profile.provider);
    client
        .list_models(&profile)
        .await
        .map_err(|e| e.to_string())
}

// ========================================================================
// Bridge commands
// ========================================================================

#[tauri::command]
pub async fn bridge_send(app: AppHandle, message: Value) -> Result<(), String> {
    bridge::bridge_send_value(app, message).await
}
