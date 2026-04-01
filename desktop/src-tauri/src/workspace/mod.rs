pub mod persistence;

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::chat::types::{ChatMessage, UiMessage};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub provider_ids: Vec<String>,
    pub conversation: Vec<ChatMessage>,
    pub ui_messages: Vec<UiMessage>,
}

impl Workspace {
    pub fn new(name: &str) -> Self {
        Self {
            id: format!("ws-{}", uuid::Uuid::new_v4()),
            name: name.to_string(),
            provider_ids: Vec::new(),
            conversation: Vec::new(),
            ui_messages: Vec::new(),
        }
    }
}

/// Summary sent to the frontend (no conversation/messages).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSummary {
    pub id: String,
    pub name: String,
    pub provider_count: usize,
}

impl From<&Workspace> for WorkspaceSummary {
    fn from(ws: &Workspace) -> Self {
        Self {
            id: ws.id.clone(),
            name: ws.name.clone(),
            provider_count: ws.provider_ids.len(),
        }
    }
}

/// Full workspace detail sent to frontend (includes messages).
#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceDetail {
    pub id: String,
    pub name: String,
    pub provider_ids: Vec<String>,
    pub ui_messages: Vec<UiMessage>,
}

impl From<&Workspace> for WorkspaceDetail {
    fn from(ws: &Workspace) -> Self {
        Self {
            id: ws.id.clone(),
            name: ws.name.clone(),
            provider_ids: ws.provider_ids.clone(),
            ui_messages: ws.ui_messages.clone(),
        }
    }
}

pub struct WorkspaceManager {
    workspaces: Vec<Workspace>,
    active_workspace_id: String,
    app_data_dir: PathBuf,
    save_pending: bool,
}

impl WorkspaceManager {
    pub fn new(app_data_dir: PathBuf) -> Arc<Mutex<Self>> {
        let mut workspaces = persistence::load_workspaces(&app_data_dir);
        if workspaces.is_empty() {
            let default = Workspace {
                id: "default".to_string(),
                name: "Default".to_string(),
                provider_ids: Vec::new(),
                conversation: Vec::new(),
                ui_messages: Vec::new(),
            };
            workspaces.push(default);
        }
        let active_id = workspaces[0].id.clone();
        Arc::new(Mutex::new(Self {
            workspaces,
            active_workspace_id: active_id,
            app_data_dir,
            save_pending: false,
        }))
    }

    pub fn list_summaries(&self) -> Vec<WorkspaceSummary> {
        self.workspaces.iter().map(WorkspaceSummary::from).collect()
    }

    pub fn get_workspace(&self, id: &str) -> Option<&Workspace> {
        self.workspaces.iter().find(|ws| ws.id == id)
    }

    pub fn get_workspace_mut(&mut self, id: &str) -> Option<&mut Workspace> {
        self.workspaces.iter_mut().find(|ws| ws.id == id)
    }

    #[allow(dead_code)]
    pub fn get_active_workspace(&self) -> &Workspace {
        self.workspaces
            .iter()
            .find(|ws| ws.id == self.active_workspace_id)
            .unwrap_or(&self.workspaces[0])
    }

    #[allow(dead_code)]
    pub fn active_workspace_id(&self) -> &str {
        &self.active_workspace_id
    }

    pub fn create_workspace(&mut self, name: &str) -> WorkspaceSummary {
        let ws = Workspace::new(name);
        let summary = WorkspaceSummary::from(&ws);
        self.active_workspace_id = ws.id.clone();
        self.workspaces.push(ws);
        self.save();
        summary
    }

    pub fn rename_workspace(&mut self, id: &str, name: &str) -> bool {
        if let Some(ws) = self.workspaces.iter_mut().find(|ws| ws.id == id) {
            ws.name = name.to_string();
            self.save();
            true
        } else {
            false
        }
    }

    pub fn delete_workspace(&mut self, id: &str) -> bool {
        if self.workspaces.len() <= 1 {
            return false;
        }
        self.workspaces.retain(|ws| ws.id != id);
        if self.active_workspace_id == id {
            self.active_workspace_id = self.workspaces[0].id.clone();
        }
        self.save();
        true
    }

    /// Switch active workspace. Returns (old_provider_ids, new_provider_ids) for connection management.
    pub fn set_active_workspace(&mut self, id: &str) -> Option<(Vec<String>, Vec<String>)> {
        let old_ws = self
            .workspaces
            .iter()
            .find(|ws| ws.id == self.active_workspace_id)?;
        let old_ids = old_ws.provider_ids.clone();

        let new_ws = self.workspaces.iter().find(|ws| ws.id == id)?;
        let new_ids = new_ws.provider_ids.clone();

        self.active_workspace_id = id.to_string();
        Some((old_ids, new_ids))
    }

    pub fn add_provider_to_workspace(&mut self, workspace_id: &str, provider_id: &str) {
        if let Some(ws) = self.workspaces.iter_mut().find(|ws| ws.id == workspace_id) {
            if !ws.provider_ids.contains(&provider_id.to_string()) {
                ws.provider_ids.push(provider_id.to_string());
                self.save();
            }
        }
    }

    pub fn remove_provider_from_workspace(&mut self, workspace_id: &str, provider_id: &str) {
        if let Some(ws) = self.workspaces.iter_mut().find(|ws| ws.id == workspace_id) {
            ws.provider_ids.retain(|id| id != provider_id);
            self.save();
        }
    }

    pub fn clear_chat(&mut self, workspace_id: &str) {
        if let Some(ws) = self.workspaces.iter_mut().find(|ws| ws.id == workspace_id) {
            ws.conversation.clear();
            ws.ui_messages.clear();
            self.save();
        }
    }

    /// Mark that a save is needed (for debounced saves during chat).
    pub fn mark_dirty(&mut self) {
        self.save_pending = true;
    }

    /// Flush pending save if dirty.
    pub fn flush_if_dirty(&mut self) {
        if self.save_pending {
            self.save_pending = false;
            persistence::save_workspaces(&self.app_data_dir, &self.workspaces);
        }
    }

    fn save(&mut self) {
        self.save_pending = false;
        persistence::save_workspaces(&self.app_data_dir, &self.workspaces);
    }
}
