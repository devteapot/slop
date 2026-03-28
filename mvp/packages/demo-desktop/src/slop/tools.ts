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

/** Walk the state tree and collect all affordances as LLM tools */
export function affordancesToTools(node: SlopNode, path = ""): LlmTool[] {
  const tools: LlmTool[] = [];
  for (const aff of node.affordances ?? []) {
    const toolName = encodeTool(path || "/", aff.action);
    tools.push({
      type: "function",
      function: {
        name: toolName,
        description:
          `${aff.label ?? aff.action}${aff.description ? ": " + aff.description : ""}` +
          ` (on ${path || "/"})` +
          (aff.dangerous ? " [DANGEROUS - confirm first]" : ""),
        parameters: aff.params ? aff.params : { type: "object", properties: {} },
      },
    });
  }
  for (const child of node.children ?? []) {
    tools.push(...affordancesToTools(child, `${path}/${child.id}`));
  }
  return tools;
}

export function encodeTool(path: string, action: string): string {
  const segments = path.split("/").filter(Boolean);
  return ["invoke", ...segments, action].join("__");
}

export function decodeTool(name: string): { path: string; action: string } {
  const parts = name.split("__");
  const action = parts[parts.length - 1];
  const pathSegments = parts.slice(1, -1);
  return { path: pathSegments.length > 0 ? "/" + pathSegments.join("/") : "/", action };
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
