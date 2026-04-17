import { resolveApp } from "../apps/registry.ts";
import { resolveMcpVariant } from "../variants/mcp-variants.ts";
import type { LlmProvider, ChatMessage, ToolDef } from "../providers/types.ts";
import type { Cell, CellMetrics, SweepConfig, TurnMetric } from "./types.ts";

interface RunMcpCellArgs {
  cell: Cell;
  sweep: SweepConfig;
  provider: LlmProvider;
}

export async function runMcpCell({ cell, sweep, provider }: RunMcpCellArgs): Promise<CellMetrics> {
  const app = resolveApp(cell.app);
  if (!app.startMcpServer || !app.mcpSystemPrompt) {
    throw new Error(`App ${cell.app} does not expose an MCP server`);
  }
  const variant = cell.mcpVariant ?? "flat";
  const scenario = app.scenarios.find((s) => s.name === cell.scenario);
  if (!scenario) throw new Error(`Scenario "${cell.scenario}" not found on app ${cell.app}`);

  const t0 = performance.now();

  let transportBytesSent = 0;
  let transportBytesReceived = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let maxContextTokens = 0;
  let turns = 0;
  let totalToolCalls = 0;
  let affordanceToolCalls = 0;
  let unknownToolCalls = 0;
  let invokeErrorCalls = 0;
  let paramErrorCalls = 0;
  let llmTimeMs = 0;
  let setupTimeMs = 0;
  let timeToFirstToolCallMs: number | null = null;
  let finishReason: CellMetrics["finishReason"] = "done";
  const turnBreakdown: TurnMetric[] = [];

  const tSetup = performance.now();
  const handle = await app.startMcpServer(cell.scale, variant);
  let verification: Awaited<ReturnType<NonNullable<typeof handle.verify>>> | undefined;
  try {
    const listed = await handle.client.listTools();
    setupTimeMs = performance.now() - tSetup;

    const mcpToolNames = new Set(listed.tools.map((t) => t.name));
    const tools: ToolDef[] = listed.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      parameters: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    }));

    const buildMcpPrompt = resolveMcpVariant(variant);
    const systemPrompt = buildMcpPrompt(app.mcpSystemPrompt);

    const history: ChatMessage[] = [{ role: "user", content: scenario.agentPrompt }];
    const tAgentStart = performance.now();

    while (turns < sweep.maxTurns) {
      turns += 1;
      const turnIndex = turns - 1;
      const tGen = performance.now();
      const res = await provider.generate({
        systemPrompt,
        messages: history,
        tools,
        temperature: sweep.temperature,
      });
      const turnLatency = performance.now() - tGen;
      llmTimeMs += turnLatency;
      inputTokens += res.usage.inputTokens;
      outputTokens += res.usage.outputTokens;
      if (res.usage.inputTokens > maxContextTokens) maxContextTokens = res.usage.inputTokens;

      history.push(res.message);
      const calls = res.message.toolCalls ?? [];
      const turn: TurnMetric = {
        index: turnIndex,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        latencyMs: turnLatency,
        toolCalls: calls.length,
        toolCallKinds: [],
      };

      if (calls.length === 0) {
        turnBreakdown.push(turn);
        finishReason = "done";
        break;
      }

      if (timeToFirstToolCallMs === null) timeToFirstToolCallMs = performance.now() - tAgentStart;

      for (const call of calls) {
        totalToolCalls += 1;
        if (!mcpToolNames.has(call.name)) {
          unknownToolCalls += 1;
          turn.toolCallKinds.push("unknown");
          history.push({
            role: "tool",
            content: JSON.stringify({ error: `unknown tool: ${call.name}` }),
            toolCallId: call.id,
            name: call.name,
          });
          continue;
        }
        try {
          const result = await handle.client.callTool({ name: call.name, arguments: call.arguments });
          const sent = JSON.stringify({ name: call.name, arguments: call.arguments }).length;
          const content = (result as { content?: Array<{ type: string; text?: string }>; isError?: boolean }).content ?? [];
          const resultText = content
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("");
          const isError = (result as { isError?: boolean }).isError === true;
          if (isError) {
            invokeErrorCalls += 1;
            turn.toolCallKinds.push("invoke_error");
          } else {
            affordanceToolCalls += 1;
            turn.toolCallKinds.push("affordance");
          }
          if (process.env.BENCH_DEBUG) {
            console.error(
              `[mcp-cell] ${isError ? "ERR " : ""}${call.name}(${JSON.stringify(call.arguments).slice(0, 200)}) → ${resultText.slice(0, 200)}`,
            );
          }
          transportBytesSent += sent;
          transportBytesReceived += resultText.length;
          history.push({
            role: "tool",
            content: resultText || JSON.stringify({ status: "ok" }),
            toolCallId: call.id,
            name: call.name,
          });
        } catch (err) {
          invokeErrorCalls += 1;
          turn.toolCallKinds.push("invoke_error");
          history.push({
            role: "tool",
            content: JSON.stringify({ error: `invoke failed: ${err instanceof Error ? err.message : String(err)}` }),
            toolCallId: call.id,
            name: call.name,
          });
        }
      }

      turnBreakdown.push(turn);
    }

    if (turns >= sweep.maxTurns && (history[history.length - 1]?.toolCalls?.length ?? 0) > 0) {
      finishReason = "max_turns";
    }

    // Verification must run while the MCP server is still alive (it rebuilds state via tool calls).
    verification = await handle.verify(scenario);
  } finally {
    await handle.stop();
  }

  const totalTimeMs = performance.now() - t0;
  const attemptedCalls = affordanceToolCalls + unknownToolCalls + paramErrorCalls + invokeErrorCalls;
  const specComplianceRate = attemptedCalls > 0 ? affordanceToolCalls / attemptedCalls : 1;

  return {
    turns,
    toolCalls: totalToolCalls,
    navigationToolCalls: 0,
    affordanceToolCalls,
    unknownToolCalls,
    invokeErrorCalls,
    paramErrorCalls,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    maxContextTokens,
    timeToFirstToolCallMs,
    setupTimeMs,
    llmTimeMs,
    totalTimeMs,
    transportBytesSent,
    transportBytesReceived,
    specComplianceRate,
    finishReason,
    turnBreakdown,
    verification: verification
      ? {
          passed: verification.passed,
          totalChecks: verification.checks.length,
          passedChecks: verification.checks.filter((c) => c.passed).length,
          failures: verification.checks.filter((c) => !c.passed).map((c) => `${c.name}${c.detail ? `: ${c.detail}` : ""}`),
        }
      : undefined,
  };
}
