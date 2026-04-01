import { useState, useRef, useEffect, useMemo } from "react";
import { useAppStore } from "../stores/app-store";
import { useChatStore } from "../stores/chat-store";

const EMPTY_MESSAGES: never[] = [];

export function ChatPanel() {
  const activeWorkspaceId = useAppStore(s => s.activeWorkspaceId);
  const providers = useAppStore(s => s.providers);

  const rawMessages = useChatStore(s => s.messages[activeWorkspaceId]);
  const messages = rawMessages ?? EMPTY_MESSAGES;
  const processing = useChatStore(s => !!s.processing[activeWorkspaceId]);
  const sendMessage = useChatStore(s => s.sendMessage);

  const connectedCount = providers.filter(p => p.status === "connected").length;
  const connected = connectedCount > 0;

  const [text, setText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const canSend = connected && !processing && text.trim().length > 0;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (connected && !processing) inputRef.current?.focus();
  }, [connected, processing]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    sendMessage(activeWorkspaceId, text.trim());
    setText("");
  }

  return (
    <div className="chat-panel">
      {messages.length === 0 ? (
        <div className="chat-empty">
          {connected
            ? `${connectedCount} provider${connectedCount > 1 ? "s" : ""} connected. Ask the AI anything.`
            : "Connect providers to start chatting."}
        </div>
      ) : (
        <div className="chat-messages">
          {messages.map(msg => (
            <div key={msg.id} className={`msg ${msg.role}`}>
              {msg.content}
            </div>
          ))}
          {processing && (
            <div className="msg tool-progress">Thinking...</div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}
      <form className="chat-input" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          placeholder={connected ? "Ask about the app..." : "Connect to a provider first"}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          disabled={!connected || processing}
          rows={1}
        />
        <button type="submit" disabled={!canSend}>Send</button>
      </form>
    </div>
  );
}
