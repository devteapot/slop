import { affordancesToTools, formatTree } from "@slop-ai/consumer/browser";
import type { SlopNode } from "@slop-ai/consumer/browser";

export type ProjectionFormat = "markdown" | ((tree: SlopNode) => string);

export interface ProjectionOptions {
  /** Coalesce rapid patches into a single model-context update. Default 250ms. */
  debounceMs?: number;
  /** Projection strategy. Default: markdown using formatTree + affordance list. */
  format?: ProjectionFormat;
  /** Optional header prepended to every projection (e.g., app name). */
  header?: string;
}

/**
 * Default markdown projection: state tree (via `formatTree`) plus the affordance
 * list (via `affordancesToTools`) so the model sees both "what is" and "what can
 * be done from here." Mirrors the pattern in the Claude slop-mcp-proxy integration.
 */
export function renderMarkdown(tree: SlopNode, header?: string): string {
  const toolSet = affordancesToTools(tree);
  const actionsText =
    toolSet.tools.length === 0
      ? "_no actions available_"
      : toolSet.tools
          .map((t) => {
            const resolved = toolSet.resolve(t.function.name);
            const action = resolved?.action ?? t.function.name;
            const pathInfo = resolved?.path
              ? `on \`${resolved.path}\``
              : `${resolved?.targets?.length ?? 0} targets`;
            return `  - **${action}** ${pathInfo}: ${t.function.description}`;
          })
          .join("\n");

  const body =
    `### State\n\`\`\`\n${formatTree(tree)}\n\`\`\`\n\n` +
    `### Actions (${toolSet.tools.length})\n${actionsText}\n`;

  return header ? `${header}\n\n${body}` : body;
}

/**
 * Create a debounced projector. Each call to `schedule(tree)` replaces the
 * pending projection; `flush()` forces the next-scheduled projection to fire
 * immediately (useful for tests and unmount).
 */
export function createProjector(
  apply: (text: string) => void,
  options: ProjectionOptions = {},
): {
  schedule(tree: SlopNode): void;
  flush(): void;
  dispose(): void;
} {
  const debounceMs = options.debounceMs ?? 250;
  const format = options.format ?? "markdown";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingTree: SlopNode | null = null;

  function run() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pendingTree) return;
    const text =
      format === "markdown" ? renderMarkdown(pendingTree, options.header) : format(pendingTree);
    pendingTree = null;
    apply(text);
  }

  return {
    schedule(tree: SlopNode) {
      pendingTree = tree;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, debounceMs);
    },
    flush() {
      run();
    },
    dispose() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pendingTree = null;
    },
  };
}
