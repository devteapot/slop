import type { SlopNode } from "./types";

export interface LlmTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface ToolSet {
  tools: LlmTool[];
  /**
   * Resolve a tool name back to invoke coordinates.
   *
   * For singleton tools: returns `{ path: "/some/path", action: "delete" }`
   * For grouped tools: returns `{ path: null, action: "delete", targets: ["/a", "/b", ...] }`
   *   — caller must extract `target` from args and use it as the path.
   */
  resolve(toolName: string): { path: string | null; action: string; targets?: string[] } | null;
}

/**
 * Walk the state tree and collect all affordances as LLM tools.
 *
 * Affordances that share the same `action` name AND identical `params` schema
 * are **grouped** into a single tool with a `target` parameter. This avoids
 * registering N tools when N nodes share the same action (e.g. 500 cards each
 * with `edit`). Instead, one `edit` tool is registered and the caller supplies
 * the node path via `target`.
 *
 * **Why group by action + schema (not node type or label)?**
 * SLOP's `invoke(path, action, params)` already includes the path — the
 * provider dispatches internally based on path + action. From the consumer
 * side, `delete` IS one operation; the `target` path differentiates
 * "delete card" from "delete comment". The LLM has the state tree in context
 * and can pick the correct path.
 *
 * Singleton affordances (unique action on a single node) keep the original
 * `{nodeId}__{action}` naming with a fixed path.
 *
 * Returns a `ToolSet` with the tools and a `resolve()` function that maps
 * tool names back to invoke coordinates.
 */
export function affordancesToTools(node: SlopNode, path = ""): ToolSet {
  // Phase 1: collect all affordances with their raw data
  const entries: AffordanceEntry[] = [];
  collectAffordances(node, path, [], entries);

  // Phase 2: group by action + canonical param schema
  const groups = groupByActionAndSchema(entries);

  // Phase 3: build tools + resolve map
  const resolveMap = new Map<string, { path: string | null; action: string; targets?: string[] }>();
  const tools: LlmTool[] = [];

  // Detect action-name collisions across groups (same action, different schemas)
  const actionNameCounts = new Map<string, number>();
  for (const group of groups) {
    const action = sanitize(group[0].action);
    actionNameCounts.set(action, (actionNameCounts.get(action) ?? 0) + 1);
  }

  // Track which action names we've used for disambiguation
  const actionNameUsed = new Map<string, number>();

  for (const group of groups) {
    const first = group[0];
    const safeAction = sanitize(first.action);

    if (group.length === 1) {
      // Singleton — keep original naming: {nodeId}__{action}
      const safeId = sanitize(first.nodeId);
      const toolName = `${safeId}__${safeAction}`;
      resolveMap.set(toolName, { path: first.path || "/", action: first.action });
      tools.push({
        type: "function",
        function: {
          name: toolName,
          description: buildDescription(first),
          parameters: first.aff.params ? first.aff.params : { type: "object", properties: {} },
        },
      });
    } else {
      // Grouped — one tool with `target` parameter
      let toolName = safeAction;

      // Disambiguate if multiple groups share the same action name (different schemas)
      if ((actionNameCounts.get(safeAction) ?? 0) > 1) {
        const idx = actionNameUsed.get(safeAction) ?? 0;
        actionNameUsed.set(safeAction, idx + 1);
        if (idx > 0) {
          // Use first entry's nodeId for disambiguation
          toolName = `${safeAction}__${sanitize(first.nodeId)}`;
        }
      }

      const targets = group.map((e) => e.path || "/");
      const baseParams = first.aff.params
        ? JSON.parse(JSON.stringify(first.aff.params))
        : { type: "object", properties: {} };

      // Add `target` as a required parameter
      if (!baseParams.properties) baseParams.properties = {};
      baseParams.properties.target = {
        type: "string",
        description:
          `Path to the target node (e.g. ${targets[0]}).` +
          ` See the state tree for valid paths.`,
      };
      if (!baseParams.required) baseParams.required = [];
      baseParams.required = ["target", ...baseParams.required];

      const isDangerous = group.some((e) => e.aff.dangerous);

      resolveMap.set(toolName, { path: null, action: first.action, targets });
      tools.push({
        type: "function",
        function: {
          name: toolName,
          description: buildGroupDescription(group, isDangerous),
          parameters: baseParams,
        },
      });
    }
  }

  return {
    tools,
    resolve(toolName: string) {
      return resolveMap.get(toolName) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface AffordanceEntry {
  nodeId: string;
  nodeType: string;
  path: string;
  action: string;
  ancestors: string[];
  aff: any;
  schemaKey: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sanitize an ID segment for use in tool names (alphanumeric + underscore only). */
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "_");
}

/** Build a canonical key for a param schema (order-independent). */
function canonicalSchemaKey(params: any): string {
  if (!params) return "";
  return JSON.stringify(sortKeysDeep(params));
}

/** Recursively sort object keys for deterministic stringification. */
function sortKeysDeep(obj: any): any {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortKeysDeep);
  const sorted: Record<string, any> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeysDeep(obj[key]);
  }
  return sorted;
}

/** Recursively collect all affordances from the tree. */
function collectAffordances(
  node: SlopNode,
  path: string,
  ancestors: string[],
  out: AffordanceEntry[],
): void {
  for (const aff of node.affordances ?? []) {
    out.push({
      nodeId: node.id,
      nodeType: node.type,
      path,
      action: aff.action,
      ancestors: ancestors.map(sanitize),
      aff,
      schemaKey: canonicalSchemaKey(aff.params),
    });
  }
  for (const child of node.children ?? []) {
    collectAffordances(child, `${path}/${child.id}`, [...ancestors, node.id], out);
  }
}

/**
 * Group affordance entries by action + param schema.
 *
 * Entries with identical `action` name AND identical canonical param schema
 * are placed in the same group. Different schemas produce separate groups,
 * even if the action name is the same (e.g. `edit` on cards vs `edit` on
 * comments with different param shapes).
 */
function groupByActionAndSchema(entries: AffordanceEntry[]): AffordanceEntry[][] {
  const groups = new Map<string, AffordanceEntry[]>();
  for (const entry of entries) {
    const key = `${entry.action}\0${entry.schemaKey}`;
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }
  return Array.from(groups.values());
}

/** Build description for a singleton tool. */
function buildDescription(entry: AffordanceEntry): string {
  let desc =
    `${entry.aff.label ?? entry.aff.action}` +
    `${entry.aff.description ? ": " + entry.aff.description : ""}` +
    ` (on ${entry.path || "/"})`;
  if (entry.aff.dangerous) desc += " [DANGEROUS - confirm first]";
  return desc;
}

/** Build description for a grouped tool. */
function buildGroupDescription(group: AffordanceEntry[], isDangerous: boolean): string {
  const first = group[0];
  let desc = first.aff.label ?? first.aff.action;
  if (first.aff.description) desc += `: ${first.aff.description}`;
  desc += ` (${group.length} targets)`;
  if (isDangerous) desc += " [DANGEROUS - confirm first]";
  return desc;
}


/** Format the state tree as readable string for LLM context */
export function formatTree(node: SlopNode, indent = 0): string {
  const pad = "  ".repeat(indent);
  const props = node.properties ?? {};
  const meta = node.meta ?? {};
  const displayName = (props.label ?? props.title) as string | undefined;
  // Always show the node ID. If there's a human-readable label/title, show both.
  const header = displayName && displayName !== node.id
    ? `${node.id}: ${displayName}`
    : node.id;
  const extra = Object.entries(props)
    .filter(([k]) => k !== "label" && k !== "title")
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");
  const affordances = (node.affordances ?? [])
    .map(a => {
      let s = a.action;
      if (a.params?.properties) {
        const params = Object.entries(a.params.properties as Record<string, any>)
          .map(([k, v]) => `${k}: ${v.type}`).join(", ");
        s += `(${params})`;
      }
      return s;
    }).join(", ");

  let line = `${pad}[${node.type}] ${header}`;
  if (extra) line += ` (${extra})`;

  // Show summary from meta (for stubs, lazy nodes, windowed collections)
  if (meta.summary) line += `  — "${meta.summary}"`;

  // Show salience when present
  const salience = meta.salience as number | undefined;
  if (salience != null) line += `  salience=${Math.round(salience * 100) / 100}`;

  if (affordances) line += `  actions: {${affordances}}`;

  const lines = [line];

  // Show window/lazy indicators
  const childCount = node.children?.length ?? 0;
  const totalChildren = meta.total_children as number | undefined;
  if (totalChildren != null && totalChildren > childCount) {
    const window = meta.window as [number, number] | undefined;
    if (window) {
      lines.push(`${pad}  (showing ${childCount} of ${totalChildren})`);
    } else if (childCount === 0) {
      lines.push(`${pad}  (${totalChildren} ${totalChildren === 1 ? "child" : "children"} not loaded)`);
    }
  }

  for (const child of node.children ?? []) {
    lines.push(formatTree(child, indent + 1));
  }
  return lines.join("\n");
}
