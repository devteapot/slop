import type { SlopNode, LlmTool, ToolSet } from "@slop-ai/consumer/browser";
import { affordancesToTools, formatTree } from "@slop-ai/consumer/browser";

export interface MergedContext {
  tools: LlmTool[];
  stateStr: string;
  singleProvider: boolean;
  providerNames: Array<{ name: string; index: number }>;
  /** Resolve a tool name (possibly provider-prefixed) back to path + action. */
  resolve(toolName: string): { providerIndex: number; path: string | null; action: string; targets?: string[] } | null;
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

  // Per-provider ToolSets for resolve
  const providerToolSets: { name: string; index: number; toolSet: ToolSet }[] = [];

  for (const { name, index, tree } of providers) {
    const toolSet = affordancesToTools(tree);
    providerToolSets.push({ name, index, toolSet });

    if (singleProvider) {
      allTools.push(...toolSet.tools);
    } else {
      const safeName = name.replace(/[^a-zA-Z0-9]/g, "_");
      for (const tool of toolSet.tools) {
        allTools.push({
          ...tool,
          function: {
            ...tool.function,
            name: `${safeName}__${tool.function.name}`,
            description: `[${name}] ${tool.function.description}`,
          },
        });
      }
      stateStr += `\n--- ${name} ---\n`;
    }

    stateStr += formatTree(tree) + "\n";
  }

  return {
    tools: allTools,
    stateStr,
    singleProvider,
    providerNames,
    resolve(toolName: string) {
      if (singleProvider) {
        const entry = providerToolSets[0];
        if (!entry) return null;
        const resolved = entry.toolSet.resolve(toolName);
        if (!resolved) return null;
        return { providerIndex: entry.index, ...resolved };
      }

      // Multi-provider: strip provider prefix, then resolve
      for (const entry of providerToolSets) {
        const safeName = entry.name.replace(/[^a-zA-Z0-9]/g, "_");
        const prefix = `${safeName}__`;
        if (toolName.startsWith(prefix)) {
          const unprefixed = toolName.slice(prefix.length);
          const resolved = entry.toolSet.resolve(unprefixed);
          if (!resolved) return null;
          return { providerIndex: entry.index, ...resolved };
        }
      }
      return null;
    },
  };
}
