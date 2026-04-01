pub mod profiles;

mod openai;
mod gemini;

use async_trait::async_trait;

use crate::chat::types::ChatMessage;
use profiles::LlmProfile;
use slop_ai::LlmTool;

#[async_trait]
pub trait LlmClient: Send + Sync {
    async fn chat_completion(
        &self,
        profile: &LlmProfile,
        messages: &[ChatMessage],
        tools: &[LlmTool],
    ) -> Result<ChatMessage, LlmError>;

    async fn list_models(&self, profile: &LlmProfile) -> Result<Vec<String>, LlmError>;
}

#[derive(Debug, thiserror::Error)]
pub enum LlmError {
    #[error("HTTP error {status}: {body}")]
    Http { status: u16, body: String },
    #[error("Request failed: {0}")]
    Request(String),
    #[error("No response from model")]
    NoResponse,
    #[error("Parse error: {0}")]
    Parse(String),
}

pub fn get_client(provider: &profiles::LlmProvider) -> Box<dyn LlmClient> {
    match provider {
        profiles::LlmProvider::Ollama
        | profiles::LlmProvider::OpenAI
        | profiles::LlmProvider::OpenRouter => Box::new(openai::OpenAiClient),
        profiles::LlmProvider::Gemini => Box::new(gemini::GeminiClient),
    }
}
