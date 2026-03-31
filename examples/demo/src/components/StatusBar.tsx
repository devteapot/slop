import { useDemo, type StatusState } from "../context";

const STATUS_COLORS: Record<StatusState, { dot: string; bg: string; text: string; border: string }> = {
  observing: { dot: "bg-secondary", bg: "bg-secondary/20", text: "text-secondary", border: "border-l-secondary" },
  acting: { dot: "bg-primary", bg: "bg-primary/20", text: "text-primary", border: "border-l-primary" },
  updating: { dot: "bg-amber", bg: "bg-amber/20", text: "text-amber", border: "border-l-amber" },
  user: { dot: "bg-secondary", bg: "bg-secondary/15", text: "text-secondary", border: "border-l-secondary" },
  idle: { dot: "bg-on-surface-variant", bg: "bg-surface-container", text: "text-on-surface-variant", border: "border-l-on-surface-variant/30" },
};

const STATUS_LABELS: Record<StatusState, string> = {
  observing: "AI OBSERVING STATE",
  acting: "AI INVOKING ACTION",
  updating: "APP STATE UPDATING",
  user: "USER INTERACTION",
  idle: "IDLE",
};

export function StatusBar() {
  const { status, mode, restartReplay, skipReplay } = useDemo();
  const isPlaying = mode === "replay" && status.state !== "idle";
  const colors = STATUS_COLORS[status.state];

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 border-l-3 ${colors.border} ${colors.bg} transition-all duration-300`}>
      {/* Status dot + label */}
      <div className="flex items-center gap-2">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors.dot} ${status.state !== "idle" ? "animate-pulse" : ""}`} />
        <span className={`font-mono text-xs font-semibold tracking-wider uppercase ${colors.text}`}>
          {STATUS_LABELS[status.state]}
        </span>
      </div>

      {/* Description */}
      <span className={`text-xs truncate flex-1 ${status.state === "idle" ? "text-on-surface-variant" : colors.text + " opacity-70"}`}>
        {status.label}
      </span>

      {/* Step counter */}
      {status.step && (
        <span className={`font-mono text-xs font-medium ${colors.text} opacity-70`}>
          Step {status.step[0]}/{status.step[1]}
        </span>
      )}

      {/* Skip button — visible during animated replay */}
      {isPlaying && (
        <button
          onClick={() => skipReplay()}
          className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-surface-highest text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
        >
          Skip ▸▸
        </button>
      )}

      {/* Mode badge — clickable to restart replay */}
      <button
        onClick={() => mode === "replay" && restartReplay()}
        className={`font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded transition-colors ${
          mode === "replay"
            ? "bg-surface-variant text-on-surface-variant hover:bg-surface-highest hover:text-on-surface cursor-pointer"
            : "bg-primary/20 text-primary cursor-default"
        }`}
      >
        {mode === "replay" ? "▸▸ replay" : mode === "interactive" ? "● live" : "○ disconnected"}
      </button>
    </div>
  );
}
