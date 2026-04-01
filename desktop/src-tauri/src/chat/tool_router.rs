use slop_ai::{affordances_to_tools, decode_tool, format_tree, LlmTool, SlopNode};

/// Context built from all connected providers in a workspace.
pub struct MergedContext {
    pub tools: Vec<LlmTool>,
    pub state_str: String,
    pub single_provider: bool,
    pub provider_names: Vec<(String, String)>, // (provider_id, provider_name)
}

/// Build merged context from connected providers.
pub fn build_merged_context(
    providers: &[(String, String, SlopNode)], // (id, name, tree)
) -> MergedContext {
    let single_provider = providers.len() == 1;
    let mut all_tools: Vec<LlmTool> = Vec::new();
    let mut state_str = String::new();
    let mut provider_names = Vec::new();

    for (id, name, tree) in providers {
        provider_names.push((id.clone(), name.clone()));
        let root_path = format!("/{}", tree.id);
        let tools = affordances_to_tools(tree, &root_path);

        if single_provider {
            all_tools.extend(tools);
        } else {
            // Prefix each tool with provider name for disambiguation
            for tool in tools {
                all_tools.push(LlmTool {
                    tool_type: tool.tool_type,
                    function: slop_ai::LlmFunction {
                        name: format!("{}__{}", name, tool.function.name),
                        description: format!("[{}] {}", name, tool.function.description),
                        parameters: tool.function.parameters,
                    },
                });
            }
            state_str.push_str(&format!("\n--- {} ---\n", name));
        }

        state_str.push_str(&format_tree(tree, 0));
        state_str.push('\n');
    }

    MergedContext {
        tools: all_tools,
        state_str,
        single_provider,
        provider_names,
    }
}

/// Route a tool call name to (provider_id, path, action).
pub fn route_tool_call(
    tool_name: &str,
    provider_names: &[(String, String)], // (id, name)
    single_provider: bool,
) -> Option<(String, String, String)> {
    if single_provider {
        if let Some((id, _)) = provider_names.first() {
            let (path, action) = decode_tool(tool_name);
            return Some((id.clone(), path, action));
        }
        return None;
    }

    // Multi-provider: strip prefix to find target
    for (id, name) in provider_names {
        let prefix = format!("{name}__");
        if tool_name.starts_with(&prefix) {
            let original_name = &tool_name[prefix.len()..];
            let (path, action) = decode_tool(original_name);
            return Some((id.clone(), path, action));
        }
    }
    None
}
