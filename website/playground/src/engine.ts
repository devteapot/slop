import { assembleTree, diffNodes } from "@slop-ai/core";
import type { SlopNode, PatchOp, ActionHandler, NodeDescriptor } from "@slop-ai/core";

export interface EvalResult {
  tree: SlopNode;
  handlers: Map<string, ActionHandler>;
  error?: undefined;
}

export interface EvalError {
  tree?: undefined;
  handlers?: undefined;
  error: string;
}

export type EvalOutcome = EvalResult | EvalError;

/**
 * A compiled playground session.
 *
 * State persists across re-assemblies so that handler mutations are visible.
 * The trick: user code runs inside a closure. State is stored in a `__state`
 * object that persists. The user's `const/let/var` declarations are rewritten
 * to read/write from `__state`, so re-running the register() calls picks up
 * mutated values without reinitializing them.
 *
 * Simpler approach: we run the code once to initialize. On re-assembly,
 * we only re-run the register() calls. We detect register calls by having
 * the user code call `register(path, descriptor)` — we intercept those.
 * The descriptors are built lazily from closures over the live state.
 *
 * ACTUAL approach (simplest correct):
 * We store descriptors as thunks. On first run, register() captures a
 * factory function. On re-assembly, we call the factories to get fresh
 * descriptors from the (mutated) closure state.
 */
export class Session {
  private factories = new Map<string, () => NodeDescriptor>();
  private runOnce: (register: (path: string, desc: NodeDescriptor) => void) => void;

  constructor(code: string) {
    const varCode = code.replace(/\b(const|let)\s+/g, "var ");

    // The factory creates the closure scope (state lives here).
    // register() is a no-op on first run, just to avoid errors.
    // It returns a function we call for re-assembly.
    const outer = new Function(`
      var register = function(){};
      ${varCode}
      return function(__reg__) {
        register = __reg__;
        ${onlyRegisterCalls(varCode)}
      };
    `) as () => (register: (path: string, desc: NodeDescriptor) => void) => void;

    this.runOnce = outer();
  }

  assemble(): EvalResult {
    const registrations = new Map<string, NodeDescriptor>();
    this.runOnce((path, descriptor) => registrations.set(path, descriptor));
    if (registrations.size === 0) {
      throw new Error("No register() calls found.");
    }
    const { tree, handlers } = assembleTree(registrations, "my-app", "My App");
    return { tree, handlers };
  }
}

/**
 * Extract only the register() call statements from the code.
 * Everything else (var declarations, assignments) is stripped.
 * This is what re-runs on each assemble — it rebuilds descriptors
 * from the live closure without resetting state.
 */
function onlyRegisterCalls(code: string): string {
  // Find register(...) calls — they can be multi-line.
  // Strategy: find `register(` and match balanced parens.
  const result: string[] = [];
  let i = 0;
  while (i < code.length) {
    const idx = code.indexOf("register(", i);
    if (idx === -1) break;

    // Check it's not inside a string or part of another word
    if (idx > 0 && /\w/.test(code[idx - 1])) {
      i = idx + 1;
      continue;
    }

    // Find the matching closing paren
    let depth = 0;
    let j = idx + "register".length;
    let inString: string | null = null;
    let escaped = false;

    while (j < code.length) {
      const ch = code[j];
      if (escaped) {
        escaped = false;
        j++;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        j++;
        continue;
      }
      if (inString) {
        if (ch === inString) inString = null;
        j++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
        j++;
        continue;
      }
      if (ch === "(") depth++;
      if (ch === ")") {
        depth--;
        if (depth === 0) {
          // Include trailing semicolon if present
          let end = j + 1;
          while (end < code.length && /[\s;]/.test(code[end])) end++;
          result.push(code.slice(idx, j + 1) + ";");
          i = end;
          break;
        }
      }
      j++;
    }

    if (depth !== 0) break; // unbalanced — bail
    if (j >= code.length) break;
  }

  return result.join("\n");
}

export function createSession(code: string): Session | EvalError {
  try {
    return new Session(code);
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function reassemble(session: Session): EvalOutcome {
  try {
    return session.assemble();
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function diff(oldTree: SlopNode, newTree: SlopNode): PatchOp[] {
  return diffNodes(oldTree, newTree);
}

export type { SlopNode, PatchOp, ActionHandler };
