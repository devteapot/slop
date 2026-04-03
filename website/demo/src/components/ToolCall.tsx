import type { ToolCallData } from "../context";

export function ToolCall({ toolCall }: { toolCall: ToolCallData }) {
  const actionName = toolCall.action;
  const hasParams = toolCall.params && Object.keys(toolCall.params).length > 0;
  const hasResult = toolCall.result != null;

  return (
    <div className="mt-2 rounded bg-surface-lowest/60 p-2 font-mono text-xs">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-primary">invoke</span>
        <span className="text-on-surface">{actionName}</span>
        <span className="text-on-surface-variant">on {toolCall.path}</span>
      </div>

      {/* Params */}
      {hasParams && (
        <div className="mt-1 text-on-surface-variant">
          {Object.entries(toolCall.params!).map(([k, v]) => (
            <div key={k} className="pl-2">
              <span className="text-secondary">{k}</span>
              <span className="text-on-surface-variant">: </span>
              <span className="text-on-surface">{JSON.stringify(v)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Result */}
      {hasResult && (
        <div className={`mt-1 pt-1 border-t border-outline-variant/15 ${
          toolCall.result!.status === "ok" ? "text-primary" : "text-error"
        }`}>
          {toolCall.result!.status === "ok" ? "✓ success" : `✗ ${toolCall.result!.status}`}
        </div>
      )}
    </div>
  );
}
