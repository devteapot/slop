use serde::{Deserialize, Serialize};

/// A message in the LLM conversation (OpenAI-compatible format).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: ToolCallFunction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallFunction {
    pub name: String,
    pub arguments: String,
}

/// A display-friendly message for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiMessage {
    pub id: String,
    pub role: String, // "user" | "assistant" | "tool-progress" | "error"
    pub content: String,
    pub timestamp: u64,
}

impl UiMessage {
    pub fn new(role: &str, content: &str) -> Self {
        Self {
            id: format!("msg-{}", uuid::Uuid::new_v4()),
            role: role.to_string(),
            content: content.to_string(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        }
    }
}
