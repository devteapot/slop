import { useState, useRef, useCallback, useEffect } from "react";
import { createSession, reassemble, diff, Session } from "./engine";
import type { SlopNode, PatchOp, ActionHandler } from "./engine";
import { STARTER_CODE } from "./starter-code";
import { Editor } from "./Editor";
import { TreePanel } from "./TreePanel";
import { ProtocolLog } from "./ProtocolLog";
import { InfoPanel } from "./InfoPanel";

export interface LogEntry {
  id: number;
  timestamp: number;
  type: "snapshot" | "patch" | "invoke" | "result";
  payload: unknown;
}

let logId = 0;

export default function App() {
  const [code, setCode] = useState(STARTER_CODE);
  const [tree, setTree] = useState<SlopNode | null>(null);
  const [handlers, setHandlers] = useState<Map<string, ActionHandler>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [changedPaths, setChangedPaths] = useState<Set<string>>(new Set());
  const [guideOpen, setGuideOpen] = useState(true);
  const prevTreeRef = useRef<SlopNode | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const isFirstEval = useRef(true);

  const addLog = useCallback((type: LogEntry["type"], payload: unknown) => {
    setLog((prev) => [...prev, { id: ++logId, timestamp: Date.now(), type, payload }]);
  }, []);

  /** Apply a new tree, diff against previous, and update state. */
  const applyTree = useCallback(
    (newTree: SlopNode, newHandlers: Map<string, ActionHandler>, isSnapshot: boolean) => {
      setTree(newTree);
      setHandlers(newHandlers);

      if (isSnapshot || !prevTreeRef.current) {
        addLog("snapshot", { version: 1, tree: summarizeTree(newTree) });
      } else {
        const ops = diff(prevTreeRef.current, newTree);
        if (ops.length > 0) {
          addLog("patch", { ops });
          flashChanged(ops, setChangedPaths);
        }
      }

      prevTreeRef.current = structuredClone(newTree);
    },
    [addLog],
  );

  /** Compile new code → new session → snapshot. */
  const compileCode = useCallback(
    (newCode: string) => {
      const result = createSession(newCode);
      if (!(result instanceof Session)) {
        setError(result.error);
        return;
      }

      sessionRef.current = result;
      const assembled = reassemble(result);
      if (assembled.error !== undefined) {
        setError(assembled.error);
        return;
      }

      setError(null);
      const isFirst = isFirstEval.current;
      isFirstEval.current = false;
      applyTree(assembled.tree, assembled.handlers, isFirst);
    },
    [applyTree],
  );

  /** Re-assemble from existing session (after handler mutations) → patch. */
  const refreshTree = useCallback(() => {
    if (!sessionRef.current) return;
    const assembled = reassemble(sessionRef.current);
    if (assembled.error !== undefined) return;
    applyTree(assembled.tree, assembled.handlers, false);
  }, [applyTree]);

  // Initial compile
  useEffect(() => {
    compileCode(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCodeChange = useCallback(
    (newCode: string) => {
      setCode(newCode);
      compileCode(newCode);
    },
    [compileCode],
  );

  const handleInvoke = useCallback(
    (handlerKey: string, params: Record<string, unknown>) => {
      const handler = handlers.get(handlerKey);
      if (!handler) return;

      addLog("invoke", { path: handlerKey, params });

      try {
        handler(params);
        addLog("result", { status: "ok" });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        addLog("result", { status: "error", message: msg });
      }

      // Re-assemble from the SAME session (mutations are in the closure)
      refreshTree();
    },
    [handlers, addLog, refreshTree],
  );

  const handleReset = useCallback(() => {
    setCode(STARTER_CODE);
    setLog([]);
    setError(null);
    prevTreeRef.current = null;
    sessionRef.current = null;
    isFirstEval.current = true;
    logId = 0;
    compileCode(STARTER_CODE);
  }, [compileCode]);

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="px-3 flex items-center justify-between h-10 bg-surface-container">
        <div className="flex items-center gap-2">
          <img src="/sloppy.svg" alt="SLOP" className="h-5 w-5" />
          <span className="font-mono text-[11px] uppercase tracking-wider text-primary">
            SLOP Playground
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="font-mono text-[11px] uppercase tracking-wider text-on-surface-variant hover:text-on-surface px-2 py-0.5 rounded-sm cursor-pointer transition-colors"
          >
            Reset
          </button>
          <a
            href="https://docs.slopai.dev/getting-started"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[11px] uppercase tracking-wider text-on-surface-variant hover:text-on-surface px-2 py-0.5 rounded-sm transition-colors"
          >
            Docs
          </a>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left: Editor */}
        <div className="flex flex-col flex-1 h-full bg-surface-lowest overflow-hidden">
          <div className="px-3 flex items-center h-8 bg-surface-container">
            <span className="font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
              Editor
            </span>
          </div>
          <Editor code={code} onChange={handleCodeChange} error={error} />
        </div>

        {/* Center: Tree + Protocol Log */}
        <div className="flex flex-col flex-1 h-full overflow-hidden">
          {/* Tree */}
          <div className="flex flex-col flex-1 min-h-0 bg-surface-low overflow-hidden">
            <div className="px-3 flex items-center h-8 bg-surface-container">
              <span className="font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
                State Tree
              </span>
            </div>
            <div className="flex-1 overflow-auto p-2 font-mono">
              {tree ? (
                <TreePanel tree={tree} changedPaths={changedPaths} onInvoke={handleInvoke} />
              ) : (
                <p className="text-sm text-on-surface-variant p-2">
                  Write some register() calls to see the tree
                </p>
              )}
            </div>
          </div>

          {/* Protocol Log */}
          <div
            className="flex flex-col bg-surface-lowest overflow-hidden"
            style={{ height: "35%" }}
          >
            <div className="px-3 flex items-center h-8 bg-surface-container">
              <span className="font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">
                Protocol Messages
              </span>
            </div>
            <ProtocolLog entries={log} />
          </div>
        </div>

        {/* Right: Guide (collapsible) */}
        <InfoPanel open={guideOpen} onToggle={() => setGuideOpen(!guideOpen)} />
      </div>
    </div>
  );
}

function summarizeTree(node: SlopNode): string {
  const label =
    (node.properties?.label ?? node.properties?.title ?? node.id) as string;
  const childCount = node.children?.length ?? 0;
  return `[${node.type}] ${label}${childCount > 0 ? ` (${childCount} children)` : ""}`;
}

function flashChanged(ops: PatchOp[], setChangedPaths: (s: Set<string>) => void) {
  const paths = new Set(
    ops.map((op) => {
      const nodePath = op.path.replace(
        /\/(properties|affordances|meta|children|content_ref)\/.*/,
        "",
      );
      return nodePath;
    }),
  );
  setChangedPaths(paths);
  setTimeout(() => setChangedPaths(new Set()), 1600);
}
