use async_trait::async_trait;
use serde_json::{json, Value};

use super::{LlmClient, LlmError};
use crate::chat::types::{ChatMessage, ToolCall, ToolCallFunction};
use crate::llm::profiles::{LlmProfile, LlmProvider};
use slop_ai::LlmTool;

pub struct OpenAiClient;

#[async_trait]
impl LlmClient for OpenAiClient {
    async fn chat_completion(
        &self,
        profile: &LlmProfile,
        messages: &[ChatMessage],
        tools: &[LlmTool],
    ) -> Result<ChatMessage, LlmError> {
        let endpoint = match profile.provider {
            LlmProvider::OpenRouter => "https://openrouter.ai/api".to_string(),
            _ => profile.endpoint.clone(),
        };
        let url = format!("{}/v1/chat/completions", endpoint);

        let client = reqwest::Client::new();
        let mut req = client.post(&url).header("Content-Type", "application/json");

        if !profile.api_key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", profile.api_key));
        }
        if profile.provider == LlmProvider::OpenRouter {
            req = req
                .header("HTTP-Referer", "https://github.com/nichochar/slop")
                .header("X-Title", "SLOP Desktop");
        }

        let mut body = json!({
            "model": profile.model,
            "messages": messages,
            "stream": false,
        });
        if !tools.is_empty() {
            body["tools"] = serde_json::to_value(tools).unwrap_or(json!([]));
        }

        let res = req
            .json(&body)
            .send()
            .await
            .map_err(|e| LlmError::Request(e.to_string()))?;

        let status = res.status().as_u16();
        if status >= 400 {
            let text = res.text().await.unwrap_or_default();
            return Err(LlmError::Http {
                status,
                body: text.chars().take(200).collect(),
            });
        }

        let data: Value = res.json().await.map_err(|e| LlmError::Parse(e.to_string()))?;
        let choice = &data["choices"][0]["message"];

        let content = choice["content"].as_str().map(|s| s.to_string());
        let tool_calls = parse_tool_calls(choice);

        Ok(ChatMessage {
            role: "assistant".to_string(),
            content,
            tool_calls,
            tool_call_id: None,
        })
    }

    async fn list_models(&self, profile: &LlmProfile) -> Result<Vec<String>, LlmError> {
        let client = reqwest::Client::new();

        match profile.provider {
            LlmProvider::Ollama => {
                let res = client
                    .get(format!("{}/api/tags", profile.endpoint))
                    .send()
                    .await
                    .map_err(|e| LlmError::Request(e.to_string()))?;
                let data: Value = res.json().await.map_err(|e| LlmError::Parse(e.to_string()))?;
                let models = data["models"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| m["name"].as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                Ok(models)
            }
            LlmProvider::OpenAI => {
                let mut req = client.get(format!("{}/v1/models", profile.endpoint));
                if !profile.api_key.is_empty() {
                    req = req.header("Authorization", format!("Bearer {}", profile.api_key));
                }
                let res = req.send().await.map_err(|e| LlmError::Request(e.to_string()))?;
                let data: Value = res.json().await.map_err(|e| LlmError::Parse(e.to_string()))?;
                let mut models: Vec<String> = data["data"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| m["id"].as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                models.sort();
                Ok(models)
            }
            LlmProvider::OpenRouter => {
                let mut req = client
                    .get("https://openrouter.ai/api/v1/models")
                    .header("HTTP-Referer", "https://github.com/nichochar/slop");
                if !profile.api_key.is_empty() {
                    req = req.header("Authorization", format!("Bearer {}", profile.api_key));
                }
                let res = req.send().await.map_err(|e| LlmError::Request(e.to_string()))?;
                let data: Value = res.json().await.map_err(|e| LlmError::Parse(e.to_string()))?;
                let mut models: Vec<String> = data["data"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| m["id"].as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                models.sort();
                Ok(models)
            }
            _ => Ok(vec![]),
        }
    }
}

fn parse_tool_calls(choice: &Value) -> Option<Vec<ToolCall>> {
    let calls = choice["tool_calls"].as_array()?;
    if calls.is_empty() {
        return None;
    }
    let result: Vec<ToolCall> = calls
        .iter()
        .filter_map(|tc| {
            Some(ToolCall {
                id: tc["id"].as_str()?.to_string(),
                call_type: tc["type"].as_str().unwrap_or("function").to_string(),
                function: ToolCallFunction {
                    name: tc["function"]["name"].as_str()?.to_string(),
                    arguments: tc["function"]["arguments"]
                        .as_str()
                        .unwrap_or("{}")
                        .to_string(),
                },
            })
        })
        .collect();
    if result.is_empty() {
        None
    } else {
        Some(result)
    }
}
