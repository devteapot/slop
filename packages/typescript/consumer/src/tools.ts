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
  /** Resolve a tool name back to the full path + action for `invoke`. */
  resolve(toolName: string): { path: string; action: string } | null;
}

/**
 * Walk the state tree and collect all affordances as LLM tools.
 *
 * Tool names use `{nodeId}__{action}` — short and LLM-friendly.
 * When two nodes share the same ID (different branches), parent IDs
 * are prepended until names are unique.
 *
 * Returns a `ToolSet` with the tools and a `resolve()` function that
 * maps tool names back to `{ path, action }` for `invoke` messages.
 */
export function affordancesToTools(node: SlopNode, path = ""): ToolSet {
  // Phase 1: collect all affordances with their raw short names
  const entries: { shortName: string; path: string; action: string; ancestors: string[]; aff: any }[] = [];
  collectAffordances(node, path, [], entries);

  // Phase 2: disambiguate collisions by prepending ancestors
  const nameMap = disambiguate(entries);

  // Phase 3: build LlmTool array + resolve map
  const resolveMap = new Map<string, { path: string; action: string }>();
  const tools: LlmTool[] = [];

  for (const entry of entries) {
    const toolName = nameMap.get(entry)!;
    resolveMap.set(toolName, { path: entry.path || "/", action: entry.action });
    tools.push({
      type: "function",
      function: {
        name: toolName,
        description:
          `${entry.aff.label ?? entry.aff.action}${entry.aff.description ? ": " + entry.aff.description : ""}` +
          ` (on ${entry.path || "/"})` +
          (entry.aff.dangerous ? " [DANGEROUS - confirm first]" : ""),
        parameters: entry.aff.params ? entry.aff.params : { type: "object", properties: {} },
      },
    });
  }

  return {
    tools,
    resolve(toolName: string) {
      return resolveMap.get(toolName) ?? null;
    },
  };
}

/** Sanitize an ID segment for use in tool names (alphanumeric + underscore only). */
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "_");
}

/** Recursively collect all affordances from the tree. */
function collectAffordances(
  node: SlopNode,
  path: string,
  ancestors: string[],
  out: { shortName: string; path: string; action: string; ancestors: string[]; aff: any }[],
): void {
  const safeId = sanitize(node.id);
  for (const aff of node.affordances ?? []) {
    const safeAction = sanitize(aff.action);
    out.push({
      shortName: `${safeId}__${safeAction}`,
      path,
      action: aff.action,
      ancestors: ancestors.map(sanitize),
      aff,
    });
  }
  for (const child of node.children ?? []) {
    collectAffordances(child, `${path}/${child.id}`, [...ancestors, node.id], out);
  }
}

/** Resolve name collisions by prepending ancestor IDs until unique. */
function disambiguate(
  entries: { shortName: string; ancestors: string[]; [k: string]: any }[],
): Map<any, string> {
  const result = new Map<any, string>();

  // Group by short name to find collisions
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const list = groups.get(entry.shortName) ?? [];
    list.push(entry);
    groups.set(entry.shortName, list);
  }

  for (const [shortName, group] of groups) {
    if (group.length === 1) {
      // No collision — use short name
      result.set(group[0], shortName);
    } else {
      // Collision — prepend ancestors until unique
      for (const entry of group) {
        let name = shortName;
        for (let i = entry.ancestors.length - 1; i >= 0; i--) {
          name = `${entry.ancestors[i]}__${name}`;
          // Check if this name is now unique among the collision group
          const sameName = group.filter(
            (e) => e !== entry && buildName(e, entry.ancestors.length - 1 - i) === name,
          );
          if (sameName.length === 0) break;
        }
        result.set(entry, name);
      }
    }
  }

  return result;
}

/** Build a disambiguated name by prepending N ancestor levels. */
function buildName(
  entry: { shortName: string; ancestors: string[] },
  ancestorLevels: number,
): string {
  let name = entry.shortName;
  for (let i = entry.ancestors.length - 1; i >= entry.ancestors.length - 1 - ancestorLevels && i >= 0; i--) {
    name = `${entry.ancestors[i]}__${name}`;
  }
  return name;
}


/** Format the state tree as readable string for LLM context */
export function formatTree(node: SlopNode, indent = 0): string {
  const pad = "  ".repeat(indent);
  const props = node.properties ?? {};
  const label = (props.label ?? props.title ?? node.id) as string;
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
  let line = `${pad}[${node.type}] ${label}`;
  if (extra) line += ` (${extra})`;
  if (affordances) line += `  actions: {${affordances}}`;
  const lines = [line];
  for (const child of node.children ?? []) {
    lines.push(formatTree(child, indent + 1));
  }
  return lines.join("\n");
}
