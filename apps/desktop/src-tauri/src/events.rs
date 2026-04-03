use serde::Serialize;
use slop_ai::SlopNode;
use tauri::{AppHandle, Emitter};

use crate::chat::types::UiMessage;
use crate::llm::profiles::LlmProfile;
use crate::provider::ProviderSummary;
use crate::workspace::WorkspaceSummary;

// -- Provider events --

#[derive(Debug, Clone, Serialize)]
pub struct ProviderDiscoveredPayload {
    pub provider: ProviderSummary,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderRemovedPayload {
    pub provider_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderStatusPayload {
    pub provider_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tree: Option<SlopNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

// -- Chat events --

#[derive(Debug, Clone, Serialize)]
pub struct ChatMessagePayload {
    pub workspace_id: String,
    pub message: UiMessage,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatProcessingPayload {
    pub workspace_id: String,
    pub processing: bool,
}

// -- Workspace events --

#[derive(Debug, Clone, Serialize)]
pub struct WorkspacesChangedPayload {
    pub workspaces: Vec<WorkspaceSummary>,
}

// -- Profile events --

#[derive(Debug, Clone, Serialize)]
pub struct ProfilesChangedPayload {
    pub profiles: Vec<LlmProfile>,
    pub active_id: String,
}

// -- Emit helpers --

pub fn emit_provider_discovered(app: &AppHandle, provider: ProviderSummary) {
    let _ = app.emit("provider-discovered", ProviderDiscoveredPayload { provider });
}

pub fn emit_provider_removed(app: &AppHandle, provider_id: String) {
    let _ = app.emit("provider-removed", ProviderRemovedPayload { provider_id });
}

pub fn emit_provider_status(app: &AppHandle, payload: ProviderStatusPayload) {
    let _ = app.emit("provider-status", payload);
}

pub fn emit_chat_message(app: &AppHandle, workspace_id: &str, message: UiMessage) {
    let _ = app.emit(
        "chat-message",
        ChatMessagePayload {
            workspace_id: workspace_id.to_string(),
            message,
        },
    );
}

pub fn emit_chat_processing(app: &AppHandle, workspace_id: &str, processing: bool) {
    let _ = app.emit(
        "chat-processing",
        ChatProcessingPayload {
            workspace_id: workspace_id.to_string(),
            processing,
        },
    );
}

pub fn emit_workspaces_changed(app: &AppHandle, workspaces: Vec<WorkspaceSummary>) {
    let _ = app.emit("workspaces-changed", WorkspacesChangedPayload { workspaces });
}

pub fn emit_profiles_changed(app: &AppHandle, profiles: Vec<LlmProfile>, active_id: String) {
    let _ = app.emit("profiles-changed", ProfilesChangedPayload { profiles, active_id });
}
