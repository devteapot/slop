import { useRef, useEffect } from "react";
import type { LogEntry } from "./App";

interface ProtocolLogProps {
  entries: LogEntry[];
}

const TYPE_STYLES: Record<string, string> = {
  snapshot: "bg-primary/12 text-primary/70",
  patch: "bg-secondary/12 text-secondary/70",
  invoke: "bg-amber/12 text-amber/70",
  result: "bg-on-surface-variant/12 text-on-surface-variant/70",
};

export function ProtocolLog({ entries }: ProtocolLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <div className="flex-1 overflow-auto px-3 pb-3 font-mono text-xs text-on-surface-variant/50">
        Protocol messages will appear here as you edit code and invoke actions.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto px-3 pb-2 font-mono text-xs">
      {entries.map((entry) => {
        const style = TYPE_STYLES[entry.type] ?? TYPE_STYLES.result;
        const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        return (
          <div key={entry.id} className="flex items-start gap-2 py-px">
            <span className="text-[11px] text-on-surface-variant/30 shrink-0">{time}</span>
            <span className={`text-[11px] px-1 rounded-sm shrink-0 ${style}`}>
              {entry.type}
            </span>
            <span className="text-on-surface-variant/60 break-all">
              {formatPayload(entry)}
            </span>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

function formatPayload(entry: LogEntry): string {
  const p = entry.payload as Record<string, unknown>;
  switch (entry.type) {
    case "snapshot":
      return `v${p.version} — ${p.tree}`;
    case "patch": {
      const ops = p.ops as Array<{ op: string; path: string; value?: unknown }>;
      return ops
        .map((op) => {
          const val = op.value !== undefined ? ` ${JSON.stringify(op.value)}` : "";
          return `${op.op} ${op.path}${val}`;
        })
        .join(" | ");
    }
    case "invoke":
      return `${p.path} ${JSON.stringify(p.params)}`;
    case "result":
      return p.status === "ok" ? "ok" : `error: ${p.message}`;
    default:
      return JSON.stringify(p);
  }
}
