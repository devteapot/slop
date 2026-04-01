use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LlmProvider {
    Ollama,
    #[serde(rename = "openai")]
    OpenAI,
    #[serde(rename = "openrouter")]
    OpenRouter,
    Gemini,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmProfile {
    pub id: String,
    pub name: String,
    pub provider: LlmProvider,
    pub endpoint: String,
    #[serde(default)]
    pub api_key: String,
    pub model: String,
}

impl LlmProfile {
    pub fn default_profile() -> Self {
        Self {
            id: "default".to_string(),
            name: "Ollama Local".to_string(),
            provider: LlmProvider::Ollama,
            endpoint: "http://localhost:11434".to_string(),
            api_key: String::new(),
            model: "qwen2.5:14b".to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct ProfileStorage {
    profiles: Vec<LlmProfile>,
    active_profile_id: String,
}

impl Default for ProfileStorage {
    fn default() -> Self {
        Self {
            profiles: vec![LlmProfile::default_profile()],
            active_profile_id: "default".to_string(),
        }
    }
}

pub struct ProfileManager {
    profiles: Vec<LlmProfile>,
    active_profile_id: String,
    app_data_dir: PathBuf,
}

impl ProfileManager {
    pub fn new(app_data_dir: PathBuf) -> Arc<Mutex<Self>> {
        let path = app_data_dir.join("profiles.json");
        let storage: ProfileStorage = match std::fs::read_to_string(&path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => ProfileStorage::default(),
        };

        Arc::new(Mutex::new(Self {
            profiles: storage.profiles,
            active_profile_id: storage.active_profile_id,
            app_data_dir,
        }))
    }

    pub fn list_profiles(&self) -> Vec<LlmProfile> {
        self.profiles.clone()
    }

    pub fn active_profile_id(&self) -> &str {
        &self.active_profile_id
    }

    pub fn get_active_profile(&self) -> LlmProfile {
        self.profiles
            .iter()
            .find(|p| p.id == self.active_profile_id)
            .cloned()
            .unwrap_or_else(|| {
                self.profiles.first().cloned().unwrap_or_else(LlmProfile::default_profile)
            })
    }

    pub fn add_profile(&mut self, profile: LlmProfile) {
        self.active_profile_id = profile.id.clone();
        self.profiles.push(profile);
        self.save();
    }

    pub fn update_profile(&mut self, id: &str, updates: serde_json::Value) {
        if let Some(profile) = self.profiles.iter_mut().find(|p| p.id == id) {
            if let Some(name) = updates.get("name").and_then(|v| v.as_str()) {
                profile.name = name.to_string();
            }
            if let Some(provider) = updates.get("provider") {
                if let Ok(p) = serde_json::from_value(provider.clone()) {
                    profile.provider = p;
                }
            }
            if let Some(endpoint) = updates.get("endpoint").and_then(|v| v.as_str()) {
                profile.endpoint = endpoint.to_string();
            }
            if let Some(api_key) = updates.get("api_key").and_then(|v| v.as_str()) {
                profile.api_key = api_key.to_string();
            }
            if let Some(model) = updates.get("model").and_then(|v| v.as_str()) {
                profile.model = model.to_string();
            }
            self.save();
        }
    }

    pub fn delete_profile(&mut self, id: &str) {
        self.profiles.retain(|p| p.id != id);
        if self.active_profile_id == id {
            self.active_profile_id = self.profiles.first().map(|p| p.id.clone()).unwrap_or_default();
        }
        self.save();
    }

    pub fn set_active_profile(&mut self, id: &str) {
        if self.profiles.iter().any(|p| p.id == id) {
            self.active_profile_id = id.to_string();
            self.save();
        }
    }

    pub fn set_model(&mut self, model: &str) {
        if let Some(profile) = self.profiles.iter_mut().find(|p| p.id == self.active_profile_id) {
            profile.model = model.to_string();
            self.save();
        }
    }

    fn save(&self) {
        let storage = ProfileStorage {
            profiles: self.profiles.clone(),
            active_profile_id: self.active_profile_id.clone(),
        };
        let path = self.app_data_dir.join("profiles.json");
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&storage) {
            let _ = std::fs::write(&path, json);
        }
    }
}
