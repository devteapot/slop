import { useEffect, useRef } from "react";
import { useDemo, createMessageId, type ToolCallData } from "../context";
import { replayScript, TOTAL_STEPS } from "./script";

const TYPEWRITER_MS_PER_WORD = 35;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function ReplayController() {
  const {
    mode,
    replayKey,
    addMessage,
    updateMessage,
    setStatus,
    executeAction,
    bumpTreeVersion,
    simulateClick,
    appState,
  } = useDemo();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (mode !== "replay") return;

    // Abort previous run if any
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    runReplay(abort.signal);

    async function runReplay(signal: AbortSignal) {
      // Small initial delay
      await sleep(500);
      if (signal.aborted) return;

      let stepNum = 0;
      let lastAssistantId: string | null = null;

      for (const step of replayScript) {
        if (signal.aborted) return;
        if (step.type !== "tool_result") stepNum++;

        await sleep(step.delay);
        if (signal.aborted) return;

        switch (step.type) {
          case "system": {
            setStatus({
              state: "observing",
              label: step.content,
              step: [stepNum, TOTAL_STEPS],
            });
            addMessage({
              id: createMessageId(),
              role: "system",
              content: step.content,
            });
            break;
          }

          case "user_message": {
            setStatus({
              state: "user",
              label: "User message",
              step: [stepNum, TOTAL_STEPS],
            });
            addMessage({
              id: createMessageId(),
              role: "user",
              content: step.content,
            });
            lastAssistantId = null;
            break;
          }

          case "ai_message": {
            setStatus({
              state: "observing",
              label: "AI reasoning...",
              step: [stepNum, TOTAL_STEPS],
            });

            const msgId = createMessageId();
            lastAssistantId = msgId;

            // Typewriter effect
            const words = step.content.split(" ");
            let revealed = "";
            addMessage({ id: msgId, role: "assistant", content: "", isTyping: true });

            for (let i = 0; i < words.length; i++) {
              if (signal.aborted) return;
              revealed += (i > 0 ? " " : "") + words[i];
              updateMessage(msgId, { content: revealed });
              await sleep(TYPEWRITER_MS_PER_WORD);
            }

            updateMessage(msgId, { isTyping: false });
            break;
          }

          case "tool_call": {
            setStatus({
              state: "acting",
              label: `Invoking ${step.action} on ${step.path}`,
              step: [stepNum, TOTAL_STEPS],
            });

            const toolCall: ToolCallData = {
              path: step.path,
              action: step.action,
              params: step.params,
            };

            if (lastAssistantId) {
              updateMessage(lastAssistantId, { toolCalls: [toolCall] });
            } else {
              const tcMsgId = createMessageId();
              lastAssistantId = tcMsgId;
              addMessage({ id: tcMsgId, role: "assistant", content: "", toolCalls: [toolCall] });
            }

            setStatus({
              state: "updating",
              label: "State updating...",
              step: [stepNum, TOTAL_STEPS],
            });
            await executeAction(step.path, step.action, step.params);
            await sleep(300);
            break;
          }

          case "tool_result": {
            setStatus({
              state: "observing",
              label: "Observing updated state...",
              step: [stepNum, TOTAL_STEPS],
            });
            lastAssistantId = null;
            break;
          }

          case "ui_action": {
            setStatus({
              state: "user",
              label: step.label,
              step: [stepNum, TOTAL_STEPS],
            });

            // Show click indicator on the target element
            if (step.clickTarget) {
              await simulateClick(step.clickTarget);
            }

            // Call the mutation on appState
            const fn = (appState as any)[step.mutation];
            if (typeof fn === "function") {
              fn(...(step.args ?? []));
            }

            // Give React a tick to re-render, then flush SLOP tree
            await sleep(50);
            bumpTreeVersion();

            await sleep(400);
            break;
          }
        }
      }

      if (!signal.aborted) {
        setStatus({ state: "idle", label: "Replay complete" });
      }
    }

    return () => abort.abort();
  }, [mode, replayKey]); // replayKey triggers restart

  return null;
}
