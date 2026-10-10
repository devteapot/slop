import { SLOP_SYSTEM_PROMPT } from "../../mcp-vs-slop/harness/slop-system-prompt.ts";

/**
 * SLOP prompt library for the Phase C ablation. Each entry takes the
 * app-specific state text (already rendered by the chosen encoder) and
 * returns the full system prompt. The registry is extended by adding
 * another entry — the cartesian sweep picks it up automatically.
 */
export type PromptBuilder = (stateContext: string) => string;

const empty: PromptBuilder = (stateContext) => stateContext;

const minimal: PromptBuilder = (stateContext) =>
  `You are an agent. Use the available tools to complete the user's task. ` +
  `Respond with "DONE" when finished.\n\n## Current state\n\n${stateContext}`;

// v1's "basic" prompt kept for regression continuity with the old harness.
const basic: PromptBuilder = (stateContext) =>
  `You are an agent. Here is the current state of the application:\n\n${stateContext}\n\n` +
  `Use the available tools to complete the task. When done, respond with "DONE".`;

const spec: PromptBuilder = (stateContext) =>
  `${SLOP_SYSTEM_PROMPT}${stateContext}\n\nComplete the task using the available tools. When done, respond with "DONE".`;

// Half-length spec prompt — compressed to the essentials. Tests how much
// of the full framing is actually doing work vs. restating what's obvious.
const SPEC_TERSE_HEADER = `You are an agent interacting with an application via the SLOP protocol.

The application exposes its state as a tree of nodes. Each node has:
- properties (data)
- affordances (actions currently available on this node — do not attempt actions that aren't listed)
- meta (optional hints like salience, summary, total_children)

Tools:
- Node actions are named \`nodeId__action\` and perform the affordance.
- \`slop_query(path)\` — load a subtree (use for lazy nodes, stubs, or windowed collections).
- \`slop_get_state\` — read the full tree.

Affordances are contextual — they may change after you act. A hidden action is an action you cannot perform right now.

## Current state

`;

const specTerse: PromptBuilder = (stateContext) =>
  `${SPEC_TERSE_HEADER}${stateContext}\n\nComplete the task using the available tools. When done, respond with "DONE".`;

// Role-play framing — same information, but packaged as a persona. Tests
// whether the model responds to instruction-following framing over raw
// specification language.
const ROLE_PLAY_HEADER = `You are a careful operations engineer working inside an application. The application shows you its current state as a tree, and the tree tells you which actions are available on which parts of the state.

Your rules:
1. Never attempt an action that isn't explicitly listed as an affordance on the node you want to act on.
2. If you can't see the thing you need, call \`slop_query\` on the path you expect, or \`slop_get_state\` to re-read the tree.
3. After you act, check whether the tree changed and whether the affordances you need still exist.

## Current state

`;

const rolePlay: PromptBuilder = (stateContext) =>
  `${ROLE_PLAY_HEADER}${stateContext}\n\nComplete the task using the available tools. When done, respond with "DONE".`;

export const PROMPT_VARIANTS: Record<string, PromptBuilder> = {
  empty,
  minimal,
  basic,
  spec,
  "spec-terse": specTerse,
  "role-play": rolePlay,
};

export function resolvePrompt(id: string): PromptBuilder {
  const fn = PROMPT_VARIANTS[id];
  if (!fn) throw new Error(`Unknown prompt variant: ${id}. Available: ${Object.keys(PROMPT_VARIANTS).join(", ")}`);
  return fn;
}
