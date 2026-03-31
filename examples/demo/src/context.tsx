import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";
import { slop } from "./slop";
import { useAppState } from "./state";
import { replayScript } from "./replay/script";

// --- Status types ---

export type StatusState = "observing" | "acting" | "updating" | "user" | "idle";

export interface DemoStatus {
  state: StatusState;
  label: string;
  step?: [number, number]; // [current, total]
}

// --- Chat types ---

export interface ToolCallData {
  path: string;
  action: string;
  params?: Record<string, unknown>;
  result?: { status: string; data?: unknown };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCallData[];
  isTyping?: boolean;
}

// --- Context ---

type AppStateReturn = ReturnType<typeof useAppState>;

interface DemoContextValue {
  mode: "replay" | "interactive" | "disconnected";
  setMode: (mode: "replay" | "interactive" | "disconnected") => void;
  replayKey: number;
  restartReplay: () => void;
  skipReplay: () => Promise<void>;
  replayComplete: boolean;
  replayAbortRef: React.RefObject<AbortController | null>;
  setReplayComplete: (v: boolean) => void;
  status: DemoStatus;
  setStatus: (status: DemoStatus) => void;
  messages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  updateMessage: (id: string, update: Partial<ChatMessage>) => void;
  executeAction: (
    path: string,
    action: string,
    params?: Record<string, unknown>,
  ) => Promise<any>;
  bumpTreeVersion: () => void;
  clickTarget: string | null;
  simulateClick: (target: string) => Promise<void>;
  appState: AppStateReturn;
  apiKey: string;
  setApiKey: (key: string) => void;
  apiProvider: string;
  setApiProvider: (provider: string) => void;
  apiModel: string;
  setApiModel: (model: string) => void;
}

const DemoContext = createContext<DemoContextValue | null>(null);

let msgCounter = 0;
const sessionId = Math.random().toString(36).slice(2, 6);
export function createMessageId(): string {
  return `msg-${sessionId}-${++msgCounter}`;
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const appState = useAppState();
  const [mode, setMode] = useState<"replay" | "interactive" | "disconnected">("replay");
  const [status, setStatus] = useState<DemoStatus>({ state: "idle", label: "Ready" });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [replayKey, setReplayKey] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [apiProvider, setApiProvider] = useState("openrouter");
  const [apiModel, setApiModel] = useState("");
  const [replayComplete, setReplayComplete] = useState(false);
  const invokeCounter = useRef(0);
  const replayAbortRef = useRef<AbortController | null>(null);

  const restartReplay = useCallback(() => {
    msgCounter = 0;
    appState.resetState();
    setMessages([]);
    setMode("replay");
    setStatus({ state: "idle", label: "Ready" });
    setReplayComplete(false);
    setReplayKey((k) => k + 1);
  }, [appState]);

  const skipReplay = useCallback(async () => {
    // Abort the animated replay
    replayAbortRef.current?.abort();

    // Execute all steps instantly — no delays, no typewriter
    const allMessages: ChatMessage[] = [];
    for (const step of replayScript) {
      switch (step.type) {
        case "system":
          allMessages.push({ id: createMessageId(), role: "system", content: step.content });
          break;
        case "user_message":
          allMessages.push({ id: createMessageId(), role: "user", content: step.content });
          break;
        case "ai_message":
          allMessages.push({ id: createMessageId(), role: "assistant", content: step.content });
          break;
        case "tool_call": {
          allMessages.push({
            id: createMessageId(),
            role: "assistant",
            content: "",
            toolCalls: [{ path: step.path, action: step.action, params: step.params }],
          });
          slop.flush();
          await slop.executeInvoke({
            id: `skip-inv-${++invokeCounter.current}`,
            path: step.path,
            action: step.action,
            params: step.params,
          });
          await new Promise((r) => setTimeout(r, 5));
          slop.flush();
          break;
        }
        case "ui_action": {
          const fn = (appState as any)[step.mutation];
          if (typeof fn === "function") fn(...(step.args ?? []));
          break;
        }
      }
    }

    // Wait for React to settle, then flush
    await new Promise((r) => setTimeout(r, 20));
    slop.flush();

    setMessages(allMessages);
    setStatus({ state: "idle", label: "Replay complete" });
    setReplayComplete(true);
    setMode("disconnected");
  }, [appState]);

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const updateMessage = useCallback((id: string, update: Partial<ChatMessage>) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...update } : m)),
    );
  }, []);

  const [clickTarget, setClickTarget] = useState<string | null>(null);

  const simulateClick = useCallback(async (target: string) => {
    setClickTarget(target);
    await new Promise((r) => setTimeout(r, 800));
    setClickTarget(null);
  }, []);

  const bumpTreeVersion = useCallback(() => {
    slop.flush(); // triggers rebuild → broadcast → tree panel receives patch
  }, []);

  const executeAction = useCallback(
    async (path: string, action: string, params?: Record<string, unknown>) => {
      slop.flush();
      const result = await slop.executeInvoke({
        id: `demo-inv-${++invokeCounter.current}`,
        path,
        action,
        params,
      });
      // React state setters are async — wait for re-render, then flush so the
      // provider rebuilds the tree and broadcasts patches. Server-side providers
      // rebuild synchronously; this delay is React-specific (see slop.ts).
      await new Promise((r) => setTimeout(r, 10));
      slop.flush();
      return result;
    },
    [],
  );

  return (
    <DemoContext.Provider
      value={{
        mode,
        setMode,
        replayKey,
        restartReplay,
        skipReplay,
        replayComplete,
        replayAbortRef,
        setReplayComplete,
        status,
        setStatus,
        messages,
        addMessage,
        updateMessage,
        executeAction,
        bumpTreeVersion,
        clickTarget,
        simulateClick,
        appState,
        apiKey,
        setApiKey,
        apiProvider,
        setApiProvider,
        apiModel,
        setApiModel,
      }}
    >
      {children}
    </DemoContext.Provider>
  );
}

export function useDemo(): DemoContextValue {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemo must be inside DemoProvider");
  return ctx;
}
