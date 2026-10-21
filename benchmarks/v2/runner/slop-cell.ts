import { SlopConsumer, WebSocketClientTransport, affordancesToTools } from "@slop-ai/consumer";
import type { SlopNode } from "@slop-ai/consumer";
import { resolveApp } from "../apps/registry.ts";
import { resolveEncoding } from "../variants/encodings.ts";
import { resolveOptimization } from "../variants/optimizations.ts";
import { resolvePrompt } from "../variants/prompts.ts";
import type { LlmProvider, ChatMessage, ToolDef } from "../providers/types.ts";
import type { Cell, CellMetrics, SweepConfig, TurnMetric } from "./types.ts";

interface RunSlopCellArgs {
  cell: Cell;
  sweep: SweepConfig;
  provider: LlmProvider;
  port: number;
}

export async function runSlopCell({ cell, sweep, provider, port }: RunSlopCellArgs): Promise<CellMetrics> {
  const app = resolveApp(cell.app);
  const optimization = resolveOptimization(cell.optimization);
  const encode = resolveEncoding(cell.encoding);
  const buildPrompt = resolvePrompt(cell.prompt);

  const scenario = app.scenarios.find((s) => s.name === cell.scenario);
  if (!scenario) throw new Error(`Scenario "${cell.scenario}" not found on app ${cell.app}`);

  const t0 = performance.now();
  const store = app.createStore(cell.scale, cell.seed);
  const server = await app.startSlopServer(store, port, optimization.serverOpts);

  let transportBytesSent = 0;
  let transportBytesReceived = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let maxContextTokens = 0;
  let turns = 0;
  let totalToolCalls = 0;
  let navigationToolCalls = 0;
  let affordanceToolCalls = 0;
  let unknownToolCalls = 0;
  let invokeErrorCalls = 0;
  let paramErrorCalls = 0;
  let llmTimeMs = 0;
  let setupTimeMs = 0;
  let timeToFirstToolCallMs: number | null = null;
  let finishReason: CellMetrics["finishReason"] = "done";
  const turnBreakdown: TurnMetric[] = [];

  try {
    const tSetup = performance.now();
    const transport = new WebSocketClientTransport(server.wsUrl);
    const consumer = new SlopConsumer(transport);
    await consumer.connect();
    const { id: subId, snapshot } = await consumer.subscribe("/", -1);
    setupTimeMs = performance.now() - tSetup;

    let toolSet = affordancesToTools(snapshot);
    const initialStateText = encode(snapshot);
    const systemPrompt = buildPrompt(initialStateText);

    const navigationTools: ToolDef[] = [
      {
        name: "slop_query",
        description:
          "Load the full subtree at a given path. Use this to expand windowed collections, load lazy children, or resolve stub nodes. Returns the subtree with all properties, children, and affordances.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Tree path to load" },
            depth: { type: "integer", description: "Resolution depth; -1 for full. Default: -1" },
          },
          required: ["path"],
        },
      },
      {
        name: "slop_get_state",
        description: "Return the current full state tree.",
        parameters: { type: "object", properties: {} },
      },
    ];

    const buildTools = (): ToolDef[] => [
      ...toolSet.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters as Record<string, unknown>,
      })),
      ...navigationTools,
    ];

    const history: ChatMessage[] = [{ role: "user", content: scenario.agentPrompt }];
    const tAgentStart = performance.now();

    while (turns < sweep.maxTurns) {
      turns += 1;
      const turnIndex = turns - 1;
      const tGen = performance.now();
      const res = await provider.generate({
        systemPrompt,
        messages: history,
        tools: buildTools(),
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

      let treeChanged = false;

      for (const call of calls) {
        totalToolCalls += 1;

        if (call.name === "slop_query") {
          navigationToolCalls += 1;
          turn.toolCallKinds.push("slop_query");
          const path = String(call.arguments.path ?? "/");
          const depth = Number.isFinite(call.arguments.depth) ? Number(call.arguments.depth) : -1;
          const subtree = await consumer.query(path, depth);
          transportBytesSent += JSON.stringify({ type: "query", path, depth }).length;
          transportBytesReceived += JSON.stringify(subtree).length;
          const subtreeText = encode(subtree as SlopNode);
          history.push({
            role: "tool",
            content: JSON.stringify({ path, tree: subtreeText }),
            toolCallId: call.id,
            name: call.name,
          });
          mergeDiscoveredAffordances(toolSet, subtree as SlopNode, path);
          treeChanged = true;
          continue;
        }

        if (call.name === "slop_get_state") {
          navigationToolCalls += 1;
          turn.toolCallKinds.push("slop_get_state");
          const currentTree = consumer.getTree(subId);
          const text = currentTree ? encode(currentTree) : "No state available";
          transportBytesReceived += text.length;
          history.push({
            role: "tool",
            content: JSON.stringify({ tree: text }),
            toolCallId: call.id,
            name: call.name,
          });
          continue;
        }

        const resolved = toolSet.resolve(call.name);
        if (!resolved) {
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

        const invokePath = resolvePath(resolved, call.arguments);
        if (!invokePath) {
          paramErrorCalls += 1;
          turn.toolCallKinds.push("param_error");
          history.push({
            role: "tool",
            content: JSON.stringify({ error: "missing target for grouped affordance" }),
            toolCallId: call.id,
            name: call.name,
          });
          continue;
        }

        try {
          const result = await consumer.invoke(invokePath, resolved.action, call.arguments);
          affordanceToolCalls += 1;
          turn.toolCallKinds.push("affordance");
          transportBytesSent += JSON.stringify({ path: invokePath, action: resolved.action, params: call.arguments }).length;
          transportBytesReceived += JSON.stringify(result).length;
          history.push({
            role: "tool",
            content: JSON.stringify(result.data ?? { status: result.status }),
            toolCallId: call.id,
            name: call.name,
          });
          treeChanged = true;
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

      if (treeChanged) {
        const updated = consumer.getTree(subId);
        if (updated) toolSet = affordancesToTools(updated);
      }
    }

    if (turns >= sweep.maxTurns && (history[history.length - 1]?.toolCalls?.length ?? 0) > 0) {
      finishReason = "max_turns";
    }

    consumer.disconnect();
  } finally {
    await server.stop();
  }

  const verification = app.verify(store, scenario);
  const totalTimeMs = performance.now() - t0;
  const attemptedCalls = affordanceToolCalls + unknownToolCalls + paramErrorCalls + invokeErrorCalls;
  const specComplianceRate = attemptedCalls > 0 ? affordanceToolCalls / attemptedCalls : 1;

  return {
    turns,
    toolCalls: totalToolCalls,
    navigationToolCalls,
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

function resolvePath(
  resolved: { path: string | null; action: string; targets?: string[] },
  args: Record<string, unknown>,
): string | null {
  if (resolved.path) return resolved.path;
  const target = args.target;
  if (typeof target === "string" && resolved.targets && resolved.targets.includes(target)) {
    return target;
  }
  return null;
}

function mergeDiscoveredAffordances(
  existing: ReturnType<typeof affordancesToTools>,
  subtree: SlopNode,
  subtreePath: string,
) {
  const subtreeTools = affordancesToTools(subtree, subtreePath);
  const existingResolve = existing.resolve.bind(existing);
  const subtreeResolve = subtreeTools.resolve.bind(subtreeTools);
  for (const tool of subtreeTools.tools) {
    if (!existing.tools.find((t) => t.function.name === tool.function.name)) {
      existing.tools.push(tool);
    }
  }
  existing.resolve = (name: string) => existingResolve(name) ?? subtreeResolve(name);
}
