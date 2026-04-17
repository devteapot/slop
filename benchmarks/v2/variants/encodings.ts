import { formatTree } from "@slop-ai/consumer";
import type { SlopNode } from "@slop-ai/consumer";

/**
 * Tree encoders translate a SlopNode into the text string embedded in the
 * system prompt. The encoder is orthogonal to server-side optimization —
 * an "optimized" tree is still a SlopNode and can be projected via any
 * encoding.
 *
 * Phase C ships five encodings. To compare cost vs. legibility on the
 * same scenario, run the ablation config which sweeps all of them.
 */
export type TreeEncoder = (node: SlopNode) => string;

const indentedText: TreeEncoder = (node) => formatTree(node);

const jsonCompact: TreeEncoder = (node) => JSON.stringify(stripNode(node));

const jsonPretty: TreeEncoder = (node) => JSON.stringify(stripNode(node), null, 2);

const yaml: TreeEncoder = (node) => {
  const lines: string[] = [];
  emitYaml(stripNode(node) as Record<string, unknown>, 0, lines);
  return lines.join("\n");
};

const markdownHeadings: TreeEncoder = (node) => {
  const lines: string[] = [];
  emitMarkdown(node, 0, lines, "");
  return lines.join("\n");
};

export const ENCODING_VARIANTS: Record<string, TreeEncoder> = {
  "indented-text": indentedText,
  "json-compact": jsonCompact,
  "json-pretty": jsonPretty,
  yaml,
  "markdown-headings": markdownHeadings,
};

export function resolveEncoding(id: string): TreeEncoder {
  const fn = ENCODING_VARIANTS[id];
  if (!fn) throw new Error(`Unknown encoding variant: ${id}. Available: ${Object.keys(ENCODING_VARIANTS).join(", ")}`);
  return fn;
}

/**
 * Strip the node tree down to a plain JSON-friendly object. We keep id, type,
 * properties, children (recursively), affordances (as compact shapes), and
 * meta. `content_ref` drops since benchmarks don't use large content payloads.
 */
function stripNode(node: SlopNode): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: node.id,
    type: node.type,
  };
  if (node.properties && Object.keys(node.properties).length > 0) out.properties = node.properties;
  if (node.meta && Object.keys(node.meta).length > 0) out.meta = node.meta;
  if (node.affordances && node.affordances.length > 0) {
    out.affordances = node.affordances.map((a) => ({
      action: a.action,
      ...(a.description && { description: a.description }),
      ...(a.params && { params: a.params }),
    }));
  }
  if (node.children && node.children.length > 0) out.children = node.children.map(stripNode);
  return out;
}

function emitYaml(value: unknown, indent: number, lines: string[]): void {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) {
    lines[lines.length - 1] = `${lines[lines.length - 1]} null`;
    return;
  }
  if (typeof value !== "object") {
    lines[lines.length - 1] = `${lines[lines.length - 1]} ${yamlScalar(value)}`;
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines[lines.length - 1] = `${lines[lines.length - 1]} []`;
      return;
    }
    for (const item of value) {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const keys = Object.keys(item as Record<string, unknown>);
        if (keys.length === 0) {
          lines.push(`${pad}- {}`);
          continue;
        }
        lines.push(`${pad}- ${keys[0]}:`);
        emitYaml((item as Record<string, unknown>)[keys[0]], indent + 1, lines);
        for (let i = 1; i < keys.length; i++) {
          lines.push(`${pad}  ${keys[i]}:`);
          emitYaml((item as Record<string, unknown>)[keys[i]], indent + 2, lines);
        }
      } else {
        lines.push(`${pad}-`);
        emitYaml(item, indent + 1, lines);
      }
    }
    return;
  }
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) {
    lines[lines.length - 1] = `${lines[lines.length - 1]} {}`;
    return;
  }
  for (const key of keys) {
    lines.push(`${pad}${key}:`);
    emitYaml((value as Record<string, unknown>)[key], indent + 1, lines);
  }
}

function yamlScalar(v: unknown): string {
  if (typeof v === "string") {
    if (/^[\w.\-/]+$/.test(v) && v !== "null" && v !== "true" && v !== "false" && v !== "") return v;
    return JSON.stringify(v);
  }
  return String(v);
}

function emitMarkdown(node: SlopNode, depth: number, lines: string[], pathPrefix: string): void {
  const heading = "#".repeat(Math.min(depth + 2, 6));
  const path = pathPrefix === "" ? `/${node.id}` : `${pathPrefix}/${node.id}`;
  lines.push(`${heading} \`${node.type}\` ${node.id}  \`${path}\``);
  if (node.meta?.summary) lines.push(`> ${node.meta.summary}`);
  if (node.properties && Object.keys(node.properties).length > 0) {
    lines.push("");
    for (const [k, v] of Object.entries(node.properties)) lines.push(`- **${k}**: ${formatProp(v)}`);
  }
  if (node.affordances && node.affordances.length > 0) {
    lines.push("");
    lines.push("actions:");
    for (const a of node.affordances) {
      const params = a.params ? Object.keys((a.params as { properties?: Record<string, unknown> }).properties ?? {}).join(", ") : "";
      lines.push(`- \`${a.action}(${params})\`${a.description ? ` — ${a.description}` : ""}`);
    }
  }
  if (node.meta && (node.meta.total_children || node.meta.window || node.meta.salience !== undefined)) {
    const metaBits: string[] = [];
    if (node.meta.total_children !== undefined) metaBits.push(`total_children=${node.meta.total_children}`);
    if (node.meta.window) metaBits.push(`window=${node.meta.window.join(",")}`);
    if (node.meta.salience !== undefined) metaBits.push(`salience=${node.meta.salience}`);
    if (metaBits.length > 0) lines.push(`_meta: ${metaBits.join(", ")}_`);
  }
  lines.push("");
  if (node.children) {
    for (const child of node.children) emitMarkdown(child, depth + 1, lines, path);
  }
}

function formatProp(v: unknown): string {
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
