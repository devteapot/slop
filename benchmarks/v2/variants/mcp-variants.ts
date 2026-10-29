/**
 * MCP variant registry — the "fair MCP" dimension. The cell runner consults
 * this before falling back to the app's default mcpSystemPrompt, so adding
 * a variant is just "add an entry, re-run the sweep."
 *
 * Phase C ships `flat` (current baseline, domain prompt only) and
 * `flat+prompt` (domain prompt + extra guidance teaching the model how to
 * behave in a flat-tool world — parity with SLOP's spec prompt). The two
 * remaining variants from the plan (`resources`, `prompts`) need new MCP
 * server entry points and are deferred.
 */
export type McpPromptBuilder = (appSystemPrompt: string) => string;

const flat: McpPromptBuilder = (appPrompt) => appPrompt;

const FLAT_PLUS_PROMPT_GUIDANCE = `\n
## How to use the tools

The application exposes a flat list of tools. You do NOT get a tree of state upfront — you must discover state by calling list_* and get_* tools. Guidance:

1. Start by calling the broadest list_* tool to understand what entities exist. Don't call get_* for individual items when you can list them.
2. Once you know what's out there, filter in your head — don't call a tool unless you need the result.
3. When you mutate state (mark_*, advance_*, set_*, delete_*), assume the change took effect unless the response says otherwise. Don't re-list to verify.
4. If a tool returns an error like "missing required fields", re-read the tool's input schema and call again with the missing parameters.
5. Tool call budgets matter — batch what you can in one turn rather than doing one-at-a-time round trips.
`;

const flatPlusPrompt: McpPromptBuilder = (appPrompt) => appPrompt + FLAT_PLUS_PROMPT_GUIDANCE;

export const MCP_VARIANTS: Record<string, McpPromptBuilder> = {
  flat,
  "flat+prompt": flatPlusPrompt,
};

export function resolveMcpVariant(id: string): McpPromptBuilder {
  const fn = MCP_VARIANTS[id];
  if (!fn) throw new Error(`Unknown mcp variant: ${id}. Available: ${Object.keys(MCP_VARIANTS).join(", ")}`);
  return fn;
}
