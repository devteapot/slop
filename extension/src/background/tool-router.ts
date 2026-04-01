import type { SlopNode, LlmTool } from "@slop-ai/consumer/browser";
import { affordancesToTools, formatTree, decodeTool } from "@slop-ai/consumer/browser";

export interface MergedContext {
  tools: LlmTool[];
  stateStr: string;
  singleProvider: boolean;
  providerNames: Array<{ name: string; index: number }>;
}

export interface ProviderTreeInfo {
  name: string;
  index: number;
  tree: SlopNode;
}

export function buildMergedContext(providers: ProviderTreeInfo[]): MergedContext {
  const singleProvider = providers.length === 1;
  const allTools: LlmTool[] = [];
  let stateStr = "";
  const providerNames = providers.map(p => ({ name: p.name, index: p.index }));

  for (const { name, tree } of providers) {
    const tools = affordancesToTools(tree);

    if (singleProvider) {
      allTools.push(...tools);
    } else {
      for (const tool of tools) {
        allTools.push({
          ...tool,
          function: {
            ...tool.function,
            name: `${name}__${tool.function.name}`,
            description: `[${name}] ${tool.function.description}`,
          },
        });
      }
      stateStr += `\n--- ${name} ---\n`;
    }

    stateStr += formatTree(tree) + "\n";
  }

  return { tools: allTools, stateStr, singleProvider, providerNames };
}

export function routeToolCall(
  toolName: string,
  providerNames: Array<{ name: string; index: number }>,
  singleProvider: boolean
): { providerIndex: number; path: string; action: string } | null {
  if (singleProvider) {
    if (providerNames.length === 0) return null;
    const { path, action } = decodeTool(toolName);
    return { providerIndex: providerNames[0].index, path, action };
  }

  for (const { name, index } of providerNames) {
    const prefix = `${name}__`;
    if (toolName.startsWith(prefix)) {
      const original = toolName.slice(prefix.length);
      const { path, action } = decodeTool(original);
      return { providerIndex: index, path, action };
    }
  }
  return null;
}
