use std::sync::Arc;

use serde_json::Value;
use tauri::AppHandle;
use tokio::sync::Mutex;

use super::tool_router::{build_merged_context, route_tool_call};
use super::types::{ChatMessage, UiMessage};
use crate::events;
use crate::llm;
use crate::llm::profiles::LlmProfile;
use crate::provider::ProviderRegistry;
use crate::workspace::WorkspaceManager;

const SYSTEM_PROMPT: &str = r#"You are an AI assistant connected to one or more applications via the SLOP protocol (State Layer for Observable Programs).

You can SEE each connected application's state as a structured tree, and you can ACT on them by calling the available tool functions.

Tool names are prefixed with the provider name to indicate which app they act on. For example:
- kanban-board__invoke__columns__backlog__add_card → acts on the Kanban Board
- project-tracker__invoke__projects__create_project → acts on the Project Tracker

When the user asks you to do something, look at all connected apps, figure out which action(s) to invoke and on which app, and call the appropriate tool(s). You can act across MULTIPLE apps in a single response.

Keep responses concise."#;

pub struct ChatEngine;

impl ChatEngine {
    pub async fn run_turn(
        app: &AppHandle,
        workspace_mgr: &Arc<Mutex<WorkspaceManager>>,
        registry: &Arc<Mutex<ProviderRegistry>>,
        workspace_id: &str,
        user_text: &str,
        profile: &LlmProfile,
    ) -> Result<(), String> {
        events::emit_chat_processing(app, workspace_id, true);

        let result = Self::run_turn_inner(
            app,
            workspace_mgr,
            registry,
            workspace_id,
            user_text,
            profile,
        )
        .await;

        // Persist workspace
        workspace_mgr.lock().await.mark_dirty();

        events::emit_chat_processing(app, workspace_id, false);

        result
    }

    async fn run_turn_inner(
        app: &AppHandle,
        workspace_mgr: &Arc<Mutex<WorkspaceManager>>,
        registry: &Arc<Mutex<ProviderRegistry>>,
        workspace_id: &str,
        user_text: &str,
        profile: &LlmProfile,
    ) -> Result<(), String> {
        // 1. Build merged context from connected providers
        let providers_data = {
            let mgr = workspace_mgr.lock().await;
            let ws = mgr
                .get_workspace(workspace_id)
                .ok_or("Workspace not found")?;
            let reg = registry.lock().await;

            let mut data = Vec::new();
            for pid in &ws.provider_ids {
                if let Some(conn) = reg.get_connection(pid) {
                    let entry = reg.get_entry(pid);
                    let name = entry
                        .and_then(|e| e.provider_name.clone())
                        .unwrap_or_else(|| {
                            entry.map(|e| e.name.clone()).unwrap_or_else(|| pid.clone())
                        });
                    let tree = conn.tree().await;
                    data.push((pid.clone(), name, tree));
                }
            }
            data
        };

        if providers_data.is_empty() {
            return Err("No connected providers in this workspace".to_string());
        }

        let merged = build_merged_context(&providers_data);

        // 2. Prepare conversation
        let user_ui_msg = UiMessage::new("user", user_text);
        events::emit_chat_message(app, workspace_id, user_ui_msg.clone());

        let (conversation, tools) = {
            let mut mgr = workspace_mgr.lock().await;
            let ws = mgr
                .get_workspace_mut(workspace_id)
                .ok_or("Workspace not found")?;

            ws.ui_messages.push(user_ui_msg);

            // Init conversation with system prompt if empty
            if ws.conversation.is_empty() {
                ws.conversation.push(ChatMessage {
                    role: "system".to_string(),
                    content: Some(SYSTEM_PROMPT.to_string()),
                    tool_calls: None,
                    tool_call_id: None,
                });
            }

            // Add user message with state context
            ws.conversation.push(ChatMessage {
                role: "user".to_string(),
                content: Some(format!(
                    "{}\n\n[Connected applications state]\n{}",
                    user_text, merged.state_str
                )),
                tool_calls: None,
                tool_call_id: None,
            });

            (ws.conversation.clone(), merged.tools.clone())
        };

        // 3. LLM call loop
        let client = llm::get_client(&profile.provider);
        let mut conversation = conversation;

        loop {
            let response = client
                .chat_completion(profile, &conversation, &tools)
                .await
                .map_err(|e| e.to_string())?;

            if response.tool_calls.is_none() || response.tool_calls.as_ref().map_or(true, |tc| tc.is_empty()) {
                // Final text response
                let content = response.content.as_deref().unwrap_or("(no response)");
                let assistant_msg = UiMessage::new("assistant", content);
                events::emit_chat_message(app, workspace_id, assistant_msg.clone());

                conversation.push(response);

                // Save to workspace
                let mut mgr = workspace_mgr.lock().await;
                if let Some(ws) = mgr.get_workspace_mut(workspace_id) {
                    ws.conversation = conversation;
                    ws.ui_messages.push(assistant_msg);
                }
                break;
            }

            // Has tool calls
            let tool_calls = response.tool_calls.as_ref().unwrap().clone();
            conversation.push(response);

            for tc in &tool_calls {
                let route = route_tool_call(
                    &tc.function.name,
                    &merged,
                );

                if route.is_none() {
                    let err_msg = format!("Error: Unknown tool {}", tc.function.name);
                    conversation.push(ChatMessage {
                        role: "tool".to_string(),
                        content: Some(err_msg),
                        tool_calls: None,
                        tool_call_id: Some(tc.id.clone()),
                    });
                    continue;
                }

                let (provider_id, path, action) = route.unwrap();
                let params: Option<Value> = serde_json::from_str(&tc.function.arguments).ok();

                // Emit progress
                let params_str = params
                    .as_ref()
                    .filter(|p| p.as_object().map_or(false, |o| !o.is_empty()))
                    .map(|p| format!(" {}", p))
                    .unwrap_or_default();
                let progress_msg =
                    UiMessage::new("tool-progress", &format!("Invoking {} on {}{}", action, path, params_str));
                events::emit_chat_message(app, workspace_id, progress_msg.clone());

                // Execute the invocation
                let result = {
                    let reg = registry.lock().await;
                    if let Some(conn) = reg.get_connection(&provider_id) {
                        let consumer = conn.consumer.clone();
                        drop(reg);
                        consumer.invoke(&path, &action, params).await
                    } else {
                        Err(slop_ai::SlopError::ConnectionClosed)
                    }
                };

                let result_str = match result {
                    Ok(v) => {
                        let data_str = v
                            .get("data")
                            .filter(|d| !d.is_null())
                            .map(|d| format!(": {}", d))
                            .unwrap_or_default();
                        format!("OK{}", data_str)
                    }
                    Err(e) => format!("Error: {}", e),
                };

                conversation.push(ChatMessage {
                    role: "tool".to_string(),
                    content: Some(result_str),
                    tool_calls: None,
                    tool_call_id: Some(tc.id.clone()),
                });

                // Save progress
                let mut mgr = workspace_mgr.lock().await;
                if let Some(ws) = mgr.get_workspace_mut(workspace_id) {
                    ws.ui_messages.push(progress_msg);
                }
            }
        }

        Ok(())
    }
}
