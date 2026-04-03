import type { ChatMessage as ChatMessageType } from "../context";
import { ToolCall } from "./ToolCall";

export function ChatMessage({ message }: { message: ChatMessageType }) {
  if (message.role === "system") {
    return (
      <div className="text-center py-2">
        <span className="text-[11px] text-on-surface-variant font-mono">
          {message.content}
        </span>
      </div>
    );
  }

  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`max-w-[85%] rounded px-3 py-2 ${
          isUser
            ? "bg-secondary-container/40 text-on-surface"
            : "bg-surface-container text-on-surface"
        }`}
      >
        {/* Label */}
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
            {isUser ? "You" : "AI Agent"}
          </span>
        </div>

        {/* Content */}
        <p className={`text-sm leading-relaxed whitespace-pre-wrap ${message.isTyping ? "typing-cursor" : ""}`}>
          {message.content}
        </p>

        {/* Tool calls */}
        {message.toolCalls?.map((tc, i) => (
          <ToolCall key={i} toolCall={tc} />
        ))}
      </div>
    </div>
  );
}
