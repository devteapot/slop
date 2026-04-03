use std::collections::HashMap;

use async_trait::async_trait;
use serde_json::{json, Value};

use super::{LlmClient, LlmError};
use crate::chat::types::{ChatMessage, ToolCall, ToolCallFunction};
use crate::llm::profiles::LlmProfile;
use slop_ai::LlmTool;

pub struct GeminiClient;

#[async_trait]
impl LlmClient for GeminiClient {
    async fn chat_completion(
        &self,
        profile: &LlmProfile,
        messages: &[ChatMessage],
        tools: &[LlmTool],
    ) -> Result<ChatMessage, LlmError> {
        let base_url = if profile.endpoint.is_empty() {
            "https://generativelanguage.googleapis.com"
        } else {
            &profile.endpoint
        };
        let url = format!(
            "{}/v1beta/models/{}:generateContent?key={}",
            base_url, profile.model, profile.api_key
        );

        // Name mapping for Gemini's alphanumeric-only constraint.
        // ONLY current tools populate the reverse map (gemini→original).
        // History names get a forward mapping for sending but never pollute
        // the reverse map, preventing bad names from prior turns from winning.
        let mut name_to_gemini: HashMap<String, String> = HashMap::new();
        let mut gemini_to_name: HashMap<String, String> = HashMap::new();

        fn make_gemini_name(original: &str, existing: &HashMap<String, String>) -> String {
            let sanitized: String = original
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' })
                .collect();
            let mut name = format!("fn_{}", sanitized);
            // Gemini limits function names to 64 characters
            if name.len() > 64 {
                name = name[..64].to_string();
            }
            // Avoid collisions from truncation
            let base = name.clone();
            let mut i = 0u32;
            while existing.contains_key(&name) && existing[&name] != original {
                i += 1;
                let suffix = format!("_{i}");
                name = format!("{}{}", &base[..64 - suffix.len()], suffix);
            }
            name
        }

        // Current tools are the ONLY authoritative source for reverse lookup
        for t in tools {
            let original = &t.function.name;
            let gname = make_gemini_name(original, &gemini_to_name);
            name_to_gemini.insert(original.clone(), gname.clone());
            gemini_to_name.insert(gname, original.clone());
        }

        // History names get forward mapping only (for building Gemini contents)
        for msg in messages {
            let names: Vec<String> = {
                let mut v = Vec::new();
                if let Some(calls) = &msg.tool_calls {
                    for tc in calls {
                        v.push(tc.function.name.clone());
                    }
                }
                if let Some(ref tc_id) = msg.tool_call_id {
                    v.push(tc_id.clone());
                }
                v
            };
            for original in names {
                if !name_to_gemini.contains_key(&original) {
                    let gname = make_gemini_name(&original, &gemini_to_name);
                    name_to_gemini.insert(original, gname);
                }
            }
        }

        // Build Gemini contents
        let mut contents: Vec<Value> = Vec::new();
        let mut system_instruction: Option<Value> = None;

        let mut i = 0;
        while i < messages.len() {
            let msg = &messages[i];
            match msg.role.as_str() {
                "system" => {
                    system_instruction = Some(json!({
                        "parts": [{"text": msg.content.as_deref().unwrap_or("")}]
                    }));
                }
                "user" => {
                    contents.push(json!({
                        "role": "user",
                        "parts": [{"text": msg.content.as_deref().unwrap_or("")}]
                    }));
                }
                "assistant" => {
                    let mut parts: Vec<Value> = Vec::new();
                    if let Some(ref content) = msg.content {
                        if !content.is_empty() {
                            parts.push(json!({"text": content}));
                        }
                    }
                    if let Some(ref calls) = msg.tool_calls {
                        for tc in calls {
                            let gemini_name = name_to_gemini
                                .get(&tc.function.name)
                                .cloned()
                                .unwrap_or_else(|| tc.function.name.clone());
                            let args: Value =
                                serde_json::from_str(&tc.function.arguments).unwrap_or(json!({}));
                            parts.push(json!({
                                "functionCall": {
                                    "name": gemini_name,
                                    "args": args,
                                }
                            }));
                        }
                    }
                    contents.push(json!({"role": "model", "parts": parts}));
                }
                "tool" => {
                    // Batch consecutive tool messages into one function content
                    let mut response_parts: Vec<Value> = Vec::new();
                    let mut j = i;
                    while j < messages.len() && messages[j].role == "tool" {
                        let tool_msg = &messages[j];
                        let tc_id = tool_msg
                            .tool_call_id
                            .as_deref()
                            .unwrap_or("unknown");
                        let gemini_name = name_to_gemini
                            .get(tc_id)
                            .cloned()
                            .unwrap_or_else(|| tc_id.to_string());
                        response_parts.push(json!({
                            "functionResponse": {
                                "name": gemini_name,
                                "response": {"content": tool_msg.content.as_deref().unwrap_or("")},
                            }
                        }));
                        j += 1;
                    }
                    contents.push(json!({"role": "function", "parts": response_parts}));
                    i = j;
                    continue; // skip the i += 1 below
                }
                _ => {}
            }
            i += 1;
        }

        // Build Gemini tools
        let gemini_tools = if !tools.is_empty() {
            let declarations: Vec<Value> = tools
                .iter()
                .map(|t| {
                    let gemini_name = name_to_gemini
                        .get(&t.function.name)
                        .cloned()
                        .unwrap_or_else(|| t.function.name.clone());
                    json!({
                        "name": gemini_name,
                        "description": format!("[{}] {}", t.function.name, t.function.description),
                        "parameters": convert_schema_for_gemini(&t.function.parameters),
                    })
                })
                .collect();
            Some(json!([{"functionDeclarations": declarations}]))
        } else {
            None
        };

        let mut body = json!({"contents": contents});
        if let Some(si) = system_instruction {
            body["systemInstruction"] = si;
        }
        if let Some(gt) = gemini_tools {
            body["tools"] = gt;
        }

        let client = reqwest::Client::new();
        let res = client
            .post(&url)
            .header("Content-Type", "application/json")
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
        let parts = data["candidates"][0]["content"]["parts"]
            .as_array()
            .ok_or(LlmError::NoResponse)?;

        let text_parts: Vec<&str> = parts
            .iter()
            .filter_map(|p| p["text"].as_str())
            .collect();

        let function_calls: Vec<&Value> = parts
            .iter()
            .filter(|p| p.get("functionCall").is_some())
            .collect();

        let content = {
            let joined = text_parts.join("");
            if joined.is_empty() {
                None
            } else {
                Some(joined)
            }
        };

        let tool_calls = if function_calls.is_empty() {
            None
        } else {
            Some(
                function_calls
                    .iter()
                    .map(|fc| {
                        let gemini_name = fc["functionCall"]["name"].as_str().unwrap_or("");
                        // Direct lookup first
                        let original_name = if let Some(name) = gemini_to_name.get(gemini_name) {
                            name.clone()
                        } else {
                            // Gemini sometimes reorders segments — sort and compare
                            let mut response_sorted: Vec<&str> = gemini_name.split('_').filter(|s| !s.is_empty()).collect();
                            response_sorted.sort();

                            let mut found = None;
                            for (gname, original) in &gemini_to_name {
                                let mut candidate_sorted: Vec<&str> = gname.split('_').filter(|s| !s.is_empty()).collect();
                                candidate_sorted.sort();
                                if candidate_sorted == response_sorted {
                                    found = Some(original.clone());
                                    break;
                                }
                            }
                            // Last resort: strip fn_ prefix so decode_tool can parse it
                            found.unwrap_or_else(|| {
                                gemini_name.strip_prefix("fn_").unwrap_or(gemini_name).to_string()
                            })
                        };
                        let args = fc["functionCall"]["args"].clone();
                        ToolCall {
                            id: original_name.clone(),
                            call_type: "function".to_string(),
                            function: ToolCallFunction {
                                name: original_name,
                                arguments: serde_json::to_string(&args).unwrap_or("{}".to_string()),
                            },
                        }
                    })
                    .collect(),
            )
        };

        Ok(ChatMessage {
            role: "assistant".to_string(),
            content,
            tool_calls,
            tool_call_id: None,
        })
    }

    async fn list_models(&self, profile: &LlmProfile) -> Result<Vec<String>, LlmError> {
        let base_url = if profile.endpoint.is_empty() {
            "https://generativelanguage.googleapis.com"
        } else {
            &profile.endpoint
        };
        let url = format!("{}/v1beta/models?key={}", base_url, profile.api_key);

        let client = reqwest::Client::new();
        let res = client
            .get(&url)
            .send()
            .await
            .map_err(|e| LlmError::Request(e.to_string()))?;
        let data: Value = res.json().await.map_err(|e| LlmError::Parse(e.to_string()))?;

        let mut models: Vec<String> = data["models"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter(|m| {
                        m["supportedGenerationMethods"]
                            .as_array()
                            .map(|methods| {
                                methods
                                    .iter()
                                    .any(|m| m.as_str() == Some("generateContent"))
                            })
                            .unwrap_or(false)
                    })
                    .filter_map(|m| {
                        m["name"]
                            .as_str()
                            .map(|n| n.replace("models/", ""))
                    })
                    .collect()
            })
            .unwrap_or_default();
        models.sort();
        Ok(models)
    }
}

fn convert_schema_for_gemini(schema: &Value) -> Value {
    let schema_type = schema.get("type").and_then(|v| v.as_str()).unwrap_or("object");
    let mut result = json!({"type": schema_type});

    if let Some(properties) = schema.get("properties").and_then(|v| v.as_object()) {
        let mut props = serde_json::Map::new();
        for (key, val) in properties {
            props.insert(key.clone(), convert_property_for_gemini(val));
        }
        result["properties"] = Value::Object(props);
    }

    if let Some(required) = schema.get("required") {
        result["required"] = required.clone();
    }

    if let Some(items) = schema.get("items") {
        result["items"] = convert_property_for_gemini(items);
    }

    result
}

fn convert_property_for_gemini(val: &Value) -> Value {
    let prop_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("string");
    let mut prop = json!({"type": prop_type});

    if let Some(desc) = val.get("description").and_then(|v| v.as_str()) {
        prop["description"] = json!(desc);
    }
    if let Some(e) = val.get("enum") {
        prop["enum"] = e.clone();
    }
    if let Some(items) = val.get("items") {
        prop["items"] = convert_property_for_gemini(items);
    }
    if let Some(properties) = val.get("properties").and_then(|v| v.as_object()) {
        let mut props = serde_json::Map::new();
        for (key, v) in properties {
            props.insert(key.clone(), convert_property_for_gemini(v));
        }
        prop["properties"] = Value::Object(props);
    }
    if let Some(required) = val.get("required") {
        prop["required"] = required.clone();
    }

    prop
}
