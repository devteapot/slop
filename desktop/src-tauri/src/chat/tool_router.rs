use slop_ai::{affordances_to_tools, format_tree, LlmFunction, LlmTool, SlopNode, ToolSet};

/// Context built from all connected providers in a workspace.
pub struct MergedContext {
    pub tools: Vec<LlmTool>,
    pub tool_sets: Vec<(String, ToolSet)>, // (provider_id, tool_set)
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
    let mut tool_sets: Vec<(String, ToolSet)> = Vec::new();
    let mut state_str = String::new();
    let mut provider_names = Vec::new();

    for (id, name, tree) in providers {
        provider_names.push((id.clone(), name.clone()));
        let root_path = format!("/{}", tree.id);
        let ts = affordances_to_tools(tree, &root_path);

        if single_provider {
            all_tools.extend(ts.tools.iter().cloned());
        } else {
            // Prefix each tool with provider name for disambiguation
            for tool in &ts.tools {
                all_tools.push(LlmTool {
                    tool_type: tool.tool_type.clone(),
                    function: LlmFunction {
                        name: format!("{}__{}", name, tool.function.name),
                        description: format!("[{}] {}", name, tool.function.description),
                        parameters: tool.function.parameters.clone(),
                    },
                });
            }
            state_str.push_str(&format!("\n--- {} ---\n", name));
        }

        tool_sets.push((id.clone(), ts));
        state_str.push_str(&format_tree(tree, 0));
        state_str.push('\n');
    }

    MergedContext {
        tools: all_tools,
        tool_sets,
        state_str,
        single_provider,
        provider_names,
    }
}

/// Route a tool call name to (provider_id, path, action).
pub fn route_tool_call(
    tool_name: &str,
    ctx: &MergedContext,
) -> Option<(String, String, String)> {
    if ctx.single_provider {
        if let Some((id, ts)) = ctx.tool_sets.first() {
            if let Some(res) = ts.resolve(tool_name) {
                return Some((id.clone(), res.path.clone(), res.action.clone()));
            }
        }
        return None;
    }

    // Multi-provider: strip prefix to find target
    for (id, name) in &ctx.provider_names {
        let prefix = format!("{name}__");
        if tool_name.starts_with(&prefix) {
            let original_name = &tool_name[prefix.len()..];
            // Find the tool_set for this provider
            if let Some((_, ts)) = ctx.tool_sets.iter().find(|(pid, _)| pid == id) {
                if let Some(res) = ts.resolve(original_name) {
                    return Some((id.clone(), res.path.clone(), res.action.clone()));
                }
            }
            return None;
        }
    }
    None
}
