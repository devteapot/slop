use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::tools::{affordances_to_tools, format_tree};

use super::service::DiscoveryService;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub content: Vec<ToolContent>,
    #[serde(skip_serializing_if = "is_false")]
    pub is_error: bool,
}

#[derive(Debug, Clone)]
pub struct DynamicToolEntry {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    pub provider_id: String,
    pub path: String,
    pub action: String,
}

#[derive(Debug, Clone)]
pub struct DynamicToolResolution {
    pub provider_id: String,
    pub path: String,
    pub action: String,
}

#[derive(Debug, Clone, Default)]
pub struct DynamicToolSet {
    pub tools: Vec<DynamicToolEntry>,
    resolve_map: HashMap<String, DynamicToolResolution>,
}

impl DynamicToolSet {
    pub fn resolve(&self, tool_name: &str) -> Option<&DynamicToolResolution> {
        self.resolve_map.get(tool_name)
    }
}

pub async fn create_dynamic_tools(service: &DiscoveryService) -> DynamicToolSet {
    let mut entries = Vec::new();
    let mut resolve_map = HashMap::new();

    for provider in service.get_providers().await {
        let Some(tree) = provider.consumer.tree(&provider.subscription_id).await else {
            continue;
        };

        let app_prefix = sanitize_prefix(&provider.id);
        let tool_set = affordances_to_tools(&tree, "");
        for tool in &tool_set.tools {
            let Some(resolution) = tool_set.resolve(&tool.function.name) else {
                continue;
            };

            let name = format!("{app_prefix}__{}", tool.function.name);
            entries.push(DynamicToolEntry {
                name: name.clone(),
                description: format!("[{}] {}", provider.name, tool.function.description),
                input_schema: tool.function.parameters.clone(),
                provider_id: provider.id.clone(),
                path: resolution.path.clone(),
                action: resolution.action.clone(),
            });
            resolve_map.insert(
                name,
                DynamicToolResolution {
                    provider_id: provider.id.clone(),
                    path: resolution.path.clone(),
                    action: resolution.action.clone(),
                },
            );
        }
    }

    DynamicToolSet {
        tools: entries,
        resolve_map,
    }
}

#[derive(Clone)]
pub struct ToolHandlers {
    service: DiscoveryService,
}

impl ToolHandlers {
    pub async fn list_apps(&self) -> ToolResult {
        let discovered = self.service.get_discovered().await;
        if discovered.is_empty() {
            return ToolResult {
                content: vec![ToolContent {
                    content_type: "text".to_string(),
                    text: "No applications found. Desktop and web apps that support external control will appear here automatically when they're running.".to_string(),
                }],
                is_error: false,
            };
        }

        let connected = self.service.get_providers().await;
        let mut connected_by_id = HashMap::new();
        for provider in connected {
            connected_by_id.insert(provider.id.clone(), provider);
        }

        let mut lines = Vec::new();
        for descriptor in discovered {
            let provider = connected_by_id.get(&descriptor.id);
            let tree = match provider {
                Some(provider) => provider.consumer.tree(&provider.subscription_id).await,
                None => None,
            };
            let action_count = tree
                .as_ref()
                .map(|tree| affordances_to_tools(tree, "").tools.len())
                .unwrap_or(0);
            let label = tree
                .as_ref()
                .and_then(|tree| tree.properties.as_ref())
                .and_then(|props| props.get("label"))
                .and_then(Value::as_str)
                .unwrap_or(&descriptor.name);
            let status = if provider.is_some() {
                format!("connected, {action_count} actions")
            } else {
                "available".to_string()
            };
            lines.push(format!(
                "- **{label}** (id: `{}`, {}) - {status}",
                descriptor.id, descriptor.transport.transport_type
            ));
        }

        ToolResult {
            content: vec![ToolContent {
                content_type: "text".to_string(),
                text: format!(
                    "Applications on this computer:\n{}\n\nUse connect_app with an app name or ID to connect and inspect it.",
                    lines.join("\n")
                ),
            }],
            is_error: false,
        }
    }

    pub async fn connect_app(&self, app: &str) -> ToolResult {
        match self.service.ensure_connected(app).await {
            Ok(Some(provider)) => {
                let Some(tree) = provider.consumer.tree(&provider.subscription_id).await else {
                    return ToolResult {
                        content: vec![ToolContent {
                            content_type: "text".to_string(),
                            text: format!("{} is connected but has no state yet.", provider.name),
                        }],
                        is_error: false,
                    };
                };

                let tool_set = affordances_to_tools(&tree, "");
                let actions = tool_set
                    .tools
                    .iter()
                    .map(|tool| {
                        let resolution = tool_set.resolve(&tool.function.name);
                        let action = resolution
                            .map(|resolution| resolution.action.as_str())
                            .unwrap_or(tool.function.name.as_str());
                        let path = resolution
                            .map(|resolution| resolution.path.as_str())
                            .unwrap_or("/");
                        format!("  - **{action}** on `{path}`: {}", tool.function.description)
                    })
                    .collect::<Vec<_>>()
                    .join("\n");

                ToolResult {
                    content: vec![ToolContent {
                        content_type: "text".to_string(),
                        text: format!(
                            "## {}\nID: `{}`\n\n### Current State\n```\n{}\n```\n\n### Available Actions ({})\n{}",
                            provider.name,
                            provider.id,
                            format_tree(&tree, 0),
                            tool_set.tools.len(),
                            actions,
                        ),
                    }],
                    is_error: false,
                }
            }
            Ok(None) => {
                let available = self
                    .service
                    .get_discovered()
                    .await
                    .into_iter()
                    .map(|descriptor| format!("{} ({})", descriptor.name, descriptor.id))
                    .collect::<Vec<_>>()
                    .join(", ");

                ToolResult {
                    content: vec![ToolContent {
                        content_type: "text".to_string(),
                        text: format!("App \"{app}\" not found. Available: {}", if available.is_empty() { "none" } else { &available }),
                    }],
                    is_error: true,
                }
            }
            Err(error) => ToolResult {
                content: vec![ToolContent {
                    content_type: "text".to_string(),
                    text: format!("Failed to connect to \"{app}\": {error}"),
                }],
                is_error: true,
            },
        }
    }

    pub async fn disconnect_app(&self, app: &str) -> ToolResult {
        if !self.service.disconnect(app).await {
            return ToolResult {
                content: vec![ToolContent {
                    content_type: "text".to_string(),
                    text: format!("App \"{app}\" is not connected. Use list_apps to see available apps."),
                }],
                is_error: true,
            };
        }

        ToolResult {
            content: vec![ToolContent {
                content_type: "text".to_string(),
                text: format!("Disconnected from \"{app}\". Its tools have been removed."),
            }],
            is_error: false,
        }
    }
}

pub fn create_tool_handlers(service: DiscoveryService) -> ToolHandlers {
    ToolHandlers { service }
}

fn sanitize_prefix(value: &str) -> String {
    value
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

fn is_false(value: &bool) -> bool {
    !value
}
