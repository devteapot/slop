import { useRef, useEffect, useState } from "react";
import { useDemo, createMessageId } from "../context";
import { ChatMessage } from "../components/ChatMessage";
import { runAgentTurn } from "../ai/agent";

const PROVIDER_MODELS: Record<string, { label: string; value: string | null }[]> = {
  openrouter: [
    { label: "Claude Sonnet 4 (default)", value: null },
    { label: "Claude Opus 4", value: "anthropic/claude-opus-4" },
    { label: "Claude Haiku 4", value: "anthropic/claude-haiku-4" },
    { label: "GPT-4o", value: "openai/gpt-4o" },
    { label: "GPT-4.1 Mini", value: "openai/gpt-4.1-mini" },
    { label: "Gemini 2.5 Flash", value: "google/gemini-2.5-flash" },
    { label: "Gemini 2.5 Pro", value: "google/gemini-2.5-pro" },
    { label: "DeepSeek V3", value: "deepseek/deepseek-chat-v3-0324" },
  ],
  openai: [
    { label: "GPT-4o (default)", value: null },
    { label: "GPT-4.1", value: "gpt-4.1" },
    { label: "GPT-4.1 Mini", value: "gpt-4.1-mini" },
    { label: "GPT-4o Mini", value: "gpt-4o-mini" },
    { label: "o4 Mini", value: "o4-mini" },
  ],
  anthropic: [
    { label: "Claude Sonnet 4 (default)", value: null },
    { label: "Claude Opus 4", value: "claude-opus-4-20250514" },
    { label: "Claude Haiku 3.5", value: "claude-3-5-haiku-20241022" },
  ],
  google: [
    { label: "Gemini 2.5 Flash (default)", value: null },
    { label: "Gemini 2.5 Pro", value: "gemini-2.5-pro" },
    { label: "Gemini 2.0 Flash Lite", value: "gemini-2.0-flash-lite" },
  ],
};

export function ChatPanel() {
  const ctx = useDemo();
  const { messages, mode, setMode, apiKey, setApiKey, apiProvider, setApiProvider, apiModel, setApiModel, addMessage, replayComplete, skipReplay } = ctx;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [sending, setSending] = useState(false);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || mode !== "interactive" || sending) return;
    const msg = input.trim();
    addMessage({
      id: createMessageId(),
      role: "user",
      content: msg,
    });
    setInput("");
    setSending(true);
    try {
      await runAgentTurn(msg, ctx);
    } catch (err: any) {
      const message = err.message ?? String(err);
      let userMessage = message;
      if (message.includes("401") || message.includes("403")) {
        userMessage = "Invalid API key. Check your key and try again.";
      } else if (message.includes("429")) {
        userMessage = "Rate limited. Wait a moment and try again.";
      } else if (message.includes("404")) {
        userMessage = "Model not found. Try a different model.";
      } else if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
        userMessage = "Network error. Check your connection and try again.";
      }
      addMessage({
        id: createMessageId(),
        role: "system",
        content: userMessage,
      });
      ctx.setStatus({ state: "idle", label: "Ready" });
    }
    setSending(false);
  };

  const handleConnect = async () => {
    if (!apiKey.trim()) return;
    // If replay is still running, skip to end state first
    if (mode === "replay" && !replayComplete) {
      await skipReplay();
    }
    setMode("interactive");
    setConfigOpen(false);
  };

  const showConnectGlow = mode === "disconnected" && !configOpen;

  return (
    <div className="flex flex-col h-full bg-surface overflow-hidden">
      {/* Header */}
      <div className="bg-surface-container">
        <div className="flex items-center justify-between px-3 h-10">
          <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
            AI Agent
          </span>
          <div className="flex items-center gap-2">
            {mode === "interactive" && (
              <button
                onClick={() => {
                  setMode("disconnected");
                  setApiKey("");
                  setApiModel("");
                  ctx.setStatus({ state: "idle", label: "Disconnected" });
                }}
                className="text-[10px] font-mono text-error/60 hover:text-error transition-colors"
              >
                Disconnect
              </button>
            )}
            <button
              onClick={() => setConfigOpen(!configOpen)}
              className={`text-[10px] font-mono transition-all ${
                showConnectGlow
                  ? "text-primary animate-pulse shadow-[0_0_12px_var(--color-primary)] px-2 py-0.5 rounded bg-primary/15"
                  : "text-secondary hover:text-on-surface"
              }`}
            >
              {configOpen ? "Close" : mode === "interactive" ? "Connected" : "Connect API"}
            </button>
          </div>
        </div>

        {/* Post-replay hint */}
        {showConnectGlow && !configOpen && (
          <div className="px-3 pb-2">
            <p className="text-xs text-primary text-center animate-pulse drop-shadow-[0_0_6px_var(--color-primary)]">
              Connect an API key to interact with the store yourself
            </p>
          </div>
        )}

        {/* API config */}
        {configOpen && (
          <div className="px-3 pb-3 flex flex-col gap-2">
            <select
              value={apiProvider}
              onChange={(e) => { setApiProvider(e.target.value); setApiModel(""); }}
              className="bg-surface-highest text-xs text-on-surface font-mono px-2 py-1 rounded outline-none"
            >
              <option value="openrouter">OpenRouter</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="google">Google</option>
            </select>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API key..."
              className="bg-surface-highest text-xs text-on-surface font-mono px-2 py-1.5 rounded outline-none placeholder:text-on-surface-variant/40 focus:shadow-[inset_0_-2px_0_0_var(--color-primary)]"
            />
            <select
              value={apiModel || "__default__"}
              onChange={(e) => setApiModel(e.target.value === "__default__" ? "" : e.target.value)}
              className="bg-surface-highest text-xs text-on-surface font-mono px-2 py-1 rounded outline-none"
            >
              {(PROVIDER_MODELS[apiProvider] ?? []).map((m) => (
                <option key={m.value ?? "__default__"} value={m.value ?? "__default__"}>
                  {m.label}
                </option>
              ))}
            </select>
            <button
              onClick={handleConnect}
              disabled={!apiKey.trim()}
              className="text-xs px-3 py-1 rounded bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-40 disabled:cursor-default transition-colors"
            >
              Connect
            </button>
          </div>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <p className="text-xs text-on-surface-variant">
              {mode === "replay"
                ? "Replay will start shortly..."
                : "Type a message to interact with the store."}
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
      </div>

      {/* Input */}
      <div className="px-3 py-2 bg-surface-container">
        {mode === "interactive" ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Ask the AI to do something..."
              className="flex-1 bg-surface-highest text-sm text-on-surface font-mono px-3 py-1.5 rounded outline-none placeholder:text-on-surface-variant/40 focus:shadow-[inset_0_-2px_0_0_var(--color-primary)]"
            />
            <button
              onClick={handleSend}
              disabled={sending}
              className="px-3 py-1 rounded bg-primary/20 text-primary text-xs hover:bg-primary/30 transition-colors disabled:opacity-50"
            >
              {sending ? "..." : "Send"}
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-on-surface-variant text-center font-mono">
            Watching AI session... Connect an API key for interactive mode.
          </p>
        )}
      </div>
    </div>
  );
}
