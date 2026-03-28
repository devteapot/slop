import { useState, useRef, useEffect } from "react";
import { useChatStore } from "../hooks/use-chat";
import { useProviderStore } from "../hooks/use-provider-store";

export function ChatPanel() {
  const messages = useChatStore(s => s.messages);
  const processing = useChatStore(s => s.processing);
  const sendMessage = useChatStore(s => s.sendMessage);
  const activeProvider = useProviderStore(s => s.getActiveProvider());

  const [text, setText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const connected = activeProvider?.status === "connected";
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
    sendMessage(text.trim());
    setText("");
  }

  return (
    <div className="chat-panel">
      {messages.length === 0 ? (
        <div className="chat-empty">
          {connected
            ? "Connected. Ask the AI to interact with the app."
            : "Connect to a provider to start chatting."}
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
        <input
          ref={inputRef}
          type="text"
          placeholder={connected ? "Ask about the app..." : "Connect to a provider first"}
          value={text}
          onChange={e => setText(e.target.value)}
          disabled={!connected || processing}
        />
        <button type="submit" disabled={!canSend}>Send</button>
      </form>
    </div>
  );
}
