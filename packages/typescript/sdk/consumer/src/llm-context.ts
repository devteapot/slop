import { formatTree } from "./tools";
import type { SlopNode } from "./types";

// Tag-detection regexes. `[^>]*` is sufficient because we never emit `>` inside
// attribute values; opening tags also tolerate hostile attribute-shaped text.
const STATE_OPEN_RE = /<\s*slop-state\b[^>]*>/gi;
const STATE_CLOSE_RE = /<\s*\/\s*slop-state\b[^>]*>/gi;
const APPS_OPEN_RE = /<\s*slop-apps-available\b[^>]*>/gi;
const APPS_CLOSE_RE = /<\s*\/\s*slop-apps-available\b[^>]*>/gi;
const STATE_BLOCK_RE = /<\s*slop-state\b[^>]*>[\s\S]*?<\s*\/\s*slop-state\b[^>]*>/gi;
const APPS_BLOCK_RE = /<\s*slop-apps-available\b[^>]*>[\s\S]*?<\s*\/\s*slop-apps-available\b[^>]*>/gi;

/**
 * Neutralize SLOP context tags inside untrusted application text so a hostile
 * property value cannot terminate the wrapping block or fake a new one.
 *
 * Rules implement the contract in spec/integrations/llm-context.md:
 *   - <slop-state ...>          -> <slop-state-escaped>
 *   - </slop-state ...>         -> <\/slop-state>
 *   - <slop-apps-available ...> -> <slop-apps-available-escaped>
 *   - </slop-apps-available ...>-> <\/slop-apps-available>
 */
export function escapeSlopContextTags(text: string): string {
  return text
    .replace(STATE_OPEN_RE, "<slop-state-escaped>")
    .replace(STATE_CLOSE_RE, "<\\/slop-state>")
    .replace(APPS_OPEN_RE, "<slop-apps-available-escaped>")
    .replace(APPS_CLOSE_RE, "<\\/slop-apps-available>");
}

export interface SlopStateApp {
  id: string;
  name: string;
  /** Materialized tree. Pass `null`/`undefined` to emit an "awaiting snapshot" marker. */
  tree?: SlopNode | null;
}

export interface RenderSlopStateInput {
  apps: SlopStateApp[];
  /** ISO timestamp emitted as the `generated_at` attribute. Defaults to `new Date().toISOString()`. */
  generatedAt?: string;
}

export interface RenderSlopStateOptions {
  format?: string;
}

/**
 * Render the live-state tail. Returns `null` when there are no apps so callers
 * can decide whether to emit any tail at all.
 */
export function renderSlopStateTail(
  input: RenderSlopStateInput,
  options: RenderSlopStateOptions = {},
): string | null {
  if (!input.apps || input.apps.length === 0) return null;
  const format = options.format ?? "text/tree";
  const generatedAt = input.generatedAt ?? new Date().toISOString();

  const sections: string[] = ["## SLOP Apps", ""];
  for (const app of input.apps) {
    const safeName = escapeSlopContextTags(app.name);
    const safeId = escapeSlopContextTags(app.id);
    sections.push(`### ${safeName} (${safeId})`);
    sections.push("");
    if (app.tree) {
      sections.push(escapeSlopContextTags(formatTree(app.tree)));
    } else {
      sections.push("(awaiting snapshot)");
    }
    sections.push("");
  }
  const body = sections.join("\n").replace(/\n+$/, "");
  return `<slop-state generated_at="${generatedAt}" format="${format}">\n${body}\n</slop-state>`;
}

export interface AvailableSlopApp {
  id: string;
  name: string;
  /** Transport hint shown alongside the app, e.g. "ws", "unix", "stdio". */
  transport?: string;
  /** Discovery source, e.g. "local" or "bridge". */
  source?: string;
  capabilities?: string[];
  summary?: string;
}

export interface RenderAvailableAppsInput {
  apps: AvailableSlopApp[];
  generatedAt?: string;
}

/**
 * Render the available-but-unconnected apps catalog. Returns `null` when the
 * list is empty.
 */
export function renderSlopAvailableApps(input: RenderAvailableAppsInput): string | null {
  if (!input.apps || input.apps.length === 0) return null;
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const lines: string[] = ["## Available SLOP Apps", ""];
  for (const app of input.apps) {
    const safeName = escapeSlopContextTags(app.name);
    const safeId = escapeSlopContextTags(app.id);
    const meta: string[] = [];
    if (app.transport) meta.push(escapeSlopContextTags(app.transport));
    if (app.source) meta.push(escapeSlopContextTags(app.source));
    let line = `- ${safeName} (id: \`${safeId}\``;
    if (meta.length > 0) line += `, ${meta.join(", ")}`;
    line += ")";
    if (app.capabilities && app.capabilities.length > 0) {
      line += ` — capabilities: ${app.capabilities.map(escapeSlopContextTags).join(", ")}`;
    }
    if (app.summary) {
      line += ` — ${escapeSlopContextTags(app.summary)}`;
    }
    lines.push(line);
  }
  return `<slop-apps-available generated_at="${generatedAt}">\n${lines.join("\n")}\n</slop-apps-available>`;
}

// ---------------------------------------------------------------------------
// Message composition
// ---------------------------------------------------------------------------

export interface TextContentBlock {
  type: "text";
  text: string;
  [key: string]: unknown;
}

export type ContentBlock = TextContentBlock | { type: string; [key: string]: unknown };

export interface ComposableMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentBlock[];
  [key: string]: unknown;
}

function stripFromString(text: string): string {
  return text.replace(STATE_BLOCK_RE, "").replace(APPS_BLOCK_RE, "");
}

function hasOnlyRoleAndContent(m: ComposableMessage): boolean {
  for (const key of Object.keys(m)) {
    if (key !== "role" && key !== "content") return false;
  }
  return true;
}

/**
 * Remove any prior `<slop-state>` and `<slop-apps-available>` blocks from
 * stored messages. Operates on string content and on text blocks inside
 * block-shaped content. Drops empty text blocks so the output never contains
 * `{ type: "text", text: "" }`.
 */
export function stripSlopContextBlocks<M extends ComposableMessage>(messages: M[]): M[] {
  const out: M[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      const stripped = stripFromString(m.content).replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
      // Same rule as the block-content path: if the message stripped down to
      // an empty string and carries no other top-level payload (tool_calls,
      // tool_call_id, etc.), it was a SLOP-context-only message — drop it
      // rather than emit an empty-content message that some providers reject.
      if (stripped.length === 0 && hasOnlyRoleAndContent(m)) continue;
      out.push({ ...m, content: stripped });
      continue;
    }
    if (Array.isArray(m.content)) {
      const cleaned: ContentBlock[] = [];
      for (const block of m.content) {
        if (block.type === "text" && typeof (block as TextContentBlock).text === "string") {
          const next = stripFromString((block as TextContentBlock).text)
            .replace(/\n{3,}/g, "\n\n")
            .replace(/\s+$/, "");
          if (next.length > 0) {
            cleaned.push({ ...(block as TextContentBlock), text: next });
          }
          continue;
        }
        cleaned.push(block);
      }
      // Drop messages that were a SLOP-context-only tail. A message qualifies
      // only when its content blocks all stripped away AND it carries no other
      // top-level payload (e.g. OpenAI-style `tool_calls`, `tool_call_id`,
      // function metadata). Otherwise we'd lose meaningful assistant turns
      // that happened to contain a context block alongside tool calls.
      if (cleaned.length === 0 && hasOnlyRoleAndContent(m)) continue;
      out.push({ ...m, content: cleaned });
      continue;
    }
    out.push(m);
  }
  return out;
}

export type SlopStatePlacement = "user-tail" | "synthetic-context";

export interface ComposeMessagesOptions<M extends ComposableMessage> {
  messages: M[];
  stateTail?: string | null;
  availableAppsTail?: string | null;
  /** Where to attach the fresh context. Defaults to `"user-tail"`. */
  placement?: SlopStatePlacement;
  /** Role used for `synthetic-context` placement. Defaults to `"user"`. */
  syntheticRole?: "user" | "system";
  /**
   * Keep the latest user message as a plain string when it already is one.
   * Default behaviour upgrades it to block-shaped content because most modern
   * APIs accept blocks and the spec recommends a separate text block.
   */
  preferStringContent?: boolean;
}

/**
 * Compose stored conversation messages with a fresh SLOP context tail.
 *
 * Always strips prior `<slop-state>` / `<slop-apps-available>` blocks first so
 * `composeMessagesWithSlopState` is idempotent: running it twice on the same
 * input produces the same output. The stored history MUST never carry SLOP
 * context across turns; this helper enforces that on every call.
 */
export function composeMessagesWithSlopState<M extends ComposableMessage>(
  opts: ComposeMessagesOptions<M>,
): M[] {
  const placement: SlopStatePlacement = opts.placement ?? "user-tail";
  const tails = [opts.stateTail, opts.availableAppsTail].filter(
    (t): t is string => typeof t === "string" && t.length > 0,
  );
  const stripped = stripSlopContextBlocks(opts.messages);
  if (tails.length === 0) return stripped;

  const tailText = tails.join("\n");

  const appendSynthetic = (msgs: M[], role: "user" | "system"): M[] => {
    const synthetic = {
      role,
      content: [{ type: "text", text: tailText } satisfies TextContentBlock],
    } as unknown as M;
    return [...msgs, synthetic];
  };

  if (placement === "synthetic-context") {
    return appendSynthetic(stripped, opts.syntheticRole ?? "user");
  }

  // user-tail: only attach when the LAST stripped message is a user message.
  // If the history ends on an assistant or tool message, attaching to an
  // earlier user message would place volatile state before later stored
  // messages and break the "tail after stored prefix" rule. Fall back to a
  // synthetic context message in that case so the tail stays last.
  const last = stripped[stripped.length - 1];
  if (!last || last.role !== "user") {
    return appendSynthetic(stripped, "user");
  }

  let updated: M;
  if (typeof last.content === "string") {
    if (opts.preferStringContent) {
      const next = last.content.length > 0 ? `${last.content}\n\n${tailText}` : tailText;
      updated = { ...last, content: next };
    } else {
      const blocks: ContentBlock[] = [];
      if (last.content.length > 0) blocks.push({ type: "text", text: last.content });
      blocks.push({ type: "text", text: tailText });
      updated = { ...last, content: blocks };
    }
  } else {
    updated = { ...last, content: [...last.content, { type: "text", text: tailText }] };
  }
  return stripped.map((m, i) => (i === stripped.length - 1 ? updated : m));
}
