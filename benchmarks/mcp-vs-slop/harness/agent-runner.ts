import { GoogleGenerativeAI, type FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { SlopConsumer, WebSocketClientTransport, affordancesToTools, formatTree } from "@slop-ai/consumer";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { IssueTrackerStore } from "../app/store";
import { createSeedData, createLargeSeedData } from "../app/seed";
import { startSlopServer, type SlopServerOpts } from "../app/slop-server";
import { MetricsCollector } from "./metrics";
import type { ScenarioResult, AgentMetrics, ProtocolLabel, VerificationSummary } from "./types";
import { estimateCost } from "./types";
import type { Scenario } from "../scenarios/types";
import type { VerificationResult } from "../scenarios/types";
import { buildSlopSystemPrompt } from "./slop-system-prompt";
import { verbose, verboseToolCall, verboseToolResult, verboseLlmTurn, verboseVerification } from "./logger";

const SLOP_PORT = 4198;

let geminiModel = "gemini-2.5-flash";

export function setGeminiModel(model: string) {
  geminiModel = model;
}

export async function runAgentBenchmark(
  scenarios: Scenario[],
  protocolFilter?: Set<string> | null,
  iterations = 1,
): Promise<ScenarioResult[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("  GEMINI_API_KEY not set, skipping agent mode");
    return [];
  }

  const shouldRun = (proto: string) => !protocolFilter || protocolFilter.has(proto);

  const genAI = new GoogleGenerativeAI(apiKey);
  const results: ScenarioResult[] = [];

  type RunConfig = {
    label: string;
    proto: ProtocolLabel;
    run: () => Promise<AgentMetrics>;
  };

  for (const scenario of scenarios) {
    console.log(`\n  Running agent scenario: ${scenario.name}${scenario.largeDataset ? " (large dataset)" : ""}`);
    const seed = scenario.largeDataset ? createLargeSeedData() : createSeedData();

    // Build list of protocols to run
    const configs: RunConfig[] = [];
    if (shouldRun("mcp")) {
      configs.push({ label: "MCP agent", proto: "mcp", run: () => runMcpAgent(genAI, scenario) });
    }
    if (shouldRun("slop")) {
      configs.push({ label: "SLOP agent (full tree)", proto: "slop", run: () => runSlopAgent(genAI, scenario, "slop", -1, undefined, seed) });
    }
    if (shouldRun("slop-optimized")) {
      configs.push({ label: "SLOP agent (optimized)", proto: "slop-optimized", run: () => runSlopAgent(genAI, scenario, "slop-optimized", -1, { optimized: true }, seed) });
    }
    if (shouldRun("slop-basic")) {
      configs.push({ label: "SLOP agent (basic prompt)", proto: "slop-basic", run: () => runSlopAgent(genAI, scenario, "slop-basic", -1, undefined, seed, true) });
    }

    const protocolResults: AgentMetrics[] = [];

    for (const config of configs) {
      const runs: AgentMetrics[] = [];
      for (let i = 0; i < iterations; i++) {
        const iterLabel = iterations > 1 ? ` [${i + 1}/${iterations}]` : "";
        console.log(`    ${config.label}...${iterLabel}`);
        runs.push(await config.run());
      }
      protocolResults.push(averageAgentMetrics(runs));
    }

    results.push({
      scenario: scenario.name,
      mode: "agent",
      results: protocolResults,
    });
  }

  return results;
}

function averageAgentMetrics(runs: AgentMetrics[]): AgentMetrics {
  if (runs.length === 1) return runs[0];

  const avg = (arr: number[]) => Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;

  // Aggregate verification: report pass rate across runs
  const verifications = runs.map((r) => r.verification).filter(Boolean);
  let verification: VerificationSummary | undefined;
  if (verifications.length > 0) {
    const passCount = verifications.filter((v) => v!.passed).length;
    const totalRuns = verifications.length;
    // Use the last run's details but update pass rate
    const last = verifications[verifications.length - 1]!;
    verification = {
      passed: passCount === totalRuns,
      totalChecks: last.totalChecks,
      passedChecks: Math.round(avg(verifications.map((v) => v!.passedChecks))),
      failures: passCount === totalRuns
        ? []
        : [`Passed ${passCount}/${totalRuns} runs. ` + last.failures.join("; ")],
    };
  }

  return {
    protocol: runs[0].protocol,
    setupTimeMs: avg(runs.map((r) => r.setupTimeMs)),
    totalTimeMs: avg(runs.map((r) => r.totalTimeMs)),
    totalBytesSent: avg(runs.map((r) => r.totalBytesSent)),
    totalBytesReceived: avg(runs.map((r) => r.totalBytesReceived)),
    totalMessagesSent: avg(runs.map((r) => r.totalMessagesSent)),
    totalMessagesReceived: avg(runs.map((r) => r.totalMessagesReceived)),
    steps: runs[runs.length - 1].steps,
    inputTokens: avg(runs.map((r) => r.inputTokens)),
    outputTokens: avg(runs.map((r) => r.outputTokens)),
    totalTokens: avg(runs.map((r) => r.totalTokens)),
    toolCalls: avg(runs.map((r) => r.toolCalls)),
    llmCalls: avg(runs.map((r) => r.llmCalls)),
    estimatedCostUsd: avg(runs.map((r) => r.estimatedCostUsd)),
    verification,
  };
}

async function runSlopAgent(
  genAI: GoogleGenerativeAI,
  scenario: Scenario,
  label: ProtocolLabel,
  depth: number,
  serverOpts?: SlopServerOpts,
  seed?: ReturnType<typeof createSeedData>,
  basicPrompt?: boolean,
): Promise<AgentMetrics> {
  const store = new IssueTrackerStore();
  store.reset(seed ?? createSeedData());
  const { server: httpServer, slop } = startSlopServer(store, SLOP_PORT, serverOpts);

  const metrics = new MetricsCollector(label);
  let inputTokens = 0;
  let outputTokens = 0;
  let toolCalls = 0;
  let llmCalls = 0;

  try {
    const transport = new WebSocketClientTransport(`ws://localhost:${SLOP_PORT}/slop`);
    const consumer = new SlopConsumer(transport);

    metrics.beginSetup();
    await consumer.connect();
    const { id: subId, snapshot } = await consumer.subscribe("/", depth);
    metrics.endSetup();

    // Convert SLOP affordances to Gemini function declarations
    let toolSet = affordancesToTools(snapshot);
    let stateContext = formatTree(snapshot);

    // Navigation tools aligned with spec concepts (see slop-system-prompt.ts)
    const navigationTools: FunctionDeclaration[] = [
      {
        name: "slop_query",
        description:
          "Load the full subtree at a given path. Use this to expand windowed collections (when total_children > visible children), load lazy children (when children are not inlined), or resolve stub nodes (when a node has only a summary). Returns the subtree with all properties, children, and affordances.",
        parameters: convertToGeminiSchema({
          type: "object",
          properties: {
            path: { type: "string", description: "The tree path to load, e.g. a collection path or a specific node path" },
            depth: { type: "integer", description: "How many levels deep to resolve. -1 for full depth. Default: -1" },
          },
          required: ["path"],
        }),
      },
      {
        name: "slop_get_state",
        description:
          "Read the current full state tree. Use this when you need a complete overview of all visible nodes to plan your next steps.",
        parameters: convertToGeminiSchema({ type: "object", properties: {} }),
      },
    ];

    function buildGeminiTools() {
      const tools = toolSet.tools.map((t): FunctionDeclaration => ({
        name: t.function.name,
        description: t.function.description,
        parameters: convertToGeminiSchema(t.function.parameters),
      }));
      tools.push(...navigationTools);
      return tools;
    }

    const model = genAI.getGenerativeModel({
      model: geminiModel,
      tools: [{ functionDeclarations: buildGeminiTools() }],
    });

    const systemPrompt = basicPrompt
      ? `You are an agent. Here is the current state of the application:\n\n${stateContext}\n\nUse the available tools to complete the task. When done, respond with "DONE".`
      : buildSlopSystemPrompt(stateContext);

    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: systemPrompt }],
        },
      ],
    });

    metrics.beginStep("agent_loop");
    const proto = label;

    verbose(proto, "Sending task prompt");
    let response = await chat.sendMessage(scenario.agentPrompt);
    llmCalls++;
    if (response.response.usageMetadata) {
      inputTokens += response.response.usageMetadata.promptTokenCount ?? 0;
      outputTokens += response.response.usageMetadata.candidatesTokenCount ?? 0;
    }

    let maxIterations = 20;
    while (maxIterations-- > 0) {
      const parts = response.response.candidates?.[0]?.content?.parts ?? [];
      const fnCalls = parts.filter((p) => "functionCall" in p);
      const textParts = parts.filter((p) => "text" in p).map((p) => (p as any).text).join("");

      if (textParts) verboseLlmTurn(proto, llmCalls, textParts);

      if (fnCalls.length === 0) {
        verbose(proto, "Agent finished (no more tool calls)");
        break;
      }

      const fnResults: { functionResponse: { name: string; response: any } }[] = [];

      let treeChanged = false;

      for (const part of fnCalls) {
        const fc = (part as any).functionCall;
        toolCalls++;
        verboseToolCall(proto, fc.name, fc.args);

        // Handle navigation tools
        if (fc.name === "slop_query") {
          const queryPath = fc.args?.path ?? "/";
          const queryDepth = fc.args?.depth ?? -1;
          const subtree = await consumer.query(queryPath, queryDepth);
          metrics.recordSend(JSON.stringify({ type: "query", path: queryPath, depth: queryDepth }).length);
          metrics.recordReceive(JSON.stringify(subtree).length);
          const subtreeText = formatTree(subtree);
          verboseToolResult(proto, fc.name, { path: queryPath, nodes: subtreeText.split("\n").length });
          fnResults.push({
            functionResponse: { name: fc.name, response: { path: queryPath, tree: subtreeText } },
          });
          // Merge discovered affordances into the active toolSet
          const subtreeTools = affordancesToTools(subtree, queryPath);
          const existingResolve = toolSet.resolve.bind(toolSet);
          const subtreeResolve = subtreeTools.resolve.bind(subtreeTools);
          // Add new tools and create a combined resolver
          const mergedTools = [...toolSet.tools];
          for (const tool of subtreeTools.tools) {
            if (!existingResolve(tool.function.name)) {
              mergedTools.push(tool);
              verbose(proto, `Discovered tool: ${tool.function.name}`);
            }
          }
          toolSet = {
            tools: mergedTools,
            resolve: (name: string) => existingResolve(name) ?? subtreeResolve(name),
          };
          treeChanged = true;
          continue;
        }

        if (fc.name === "slop_get_state") {
          const currentTree = consumer.getTree(subId);
          const stateText = currentTree ? formatTree(currentTree) : "No state available";
          metrics.recordReceive(stateText.length);
          verboseToolResult(proto, fc.name, { nodes: stateText.split("\n").length });
          fnResults.push({
            functionResponse: { name: fc.name, response: { tree: stateText } },
          });
          continue;
        }

        const resolved = toolSet.resolve(fc.name);
        if (resolved) {
          const result = await consumer.invoke(resolved.path, resolved.action, fc.args);
          metrics.recordSend(JSON.stringify({ path: resolved.path, action: resolved.action, params: fc.args }).length);
          metrics.recordReceive(JSON.stringify(result).length);
          const rawData = result.data ?? { status: result.status };
          const responseObj = Array.isArray(rawData) ? { results: rawData } : (typeof rawData === "object" && rawData !== null ? rawData : { value: rawData });
          verboseToolResult(proto, fc.name, responseObj);
          fnResults.push({
            functionResponse: { name: fc.name, response: responseObj },
          });
          treeChanged = true;
        } else {
          verbose(proto, `Unknown tool: ${fc.name}`);
          fnResults.push({
            functionResponse: { name: fc.name, response: { error: "unknown tool" } },
          });
        }
      }

      if (treeChanged) {
        const updatedTree = consumer.getTree(subId);
        if (updatedTree) {
          toolSet = affordancesToTools(updatedTree);
          verbose(proto, `Tool list rebuilt: ${toolSet.tools.length} tools`);
        }
      }

      response = await chat.sendMessage(fnResults);
      llmCalls++;
      if (response.response.usageMetadata) {
        inputTokens += response.response.usageMetadata.promptTokenCount ?? 0;
        outputTokens += response.response.usageMetadata.candidatesTokenCount ?? 0;
      }
    }

    metrics.endStep();
    consumer.disconnect();
  } finally {
    slop.stop();
    httpServer.stop();
  }

  // Verify correctness against the store
  let verification: VerificationSummary | undefined;
  if (scenario.verify) {
    verbose(label, "Running verification...");
    const result = scenario.verify(store);
    verification = toSummary(result, label);
  }

  const base = metrics.toMetrics();
  return {
    ...base,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    toolCalls,
    llmCalls,
    estimatedCostUsd: estimateCost(inputTokens, outputTokens),
    verification,
  };
}

async function runMcpAgent(
  genAI: GoogleGenerativeAI,
  scenario: Scenario,
): Promise<AgentMetrics> {
  const metrics = new MetricsCollector("mcp");
  let inputTokens = 0;
  let outputTokens = 0;
  let toolCalls = 0;
  let llmCalls = 0;

  const env = scenario.largeDataset ? { ...process.env, BENCH_LARGE_DATASET: "1" } : undefined;
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", `${import.meta.dir}/../app/mcp-server.ts`],
    ...(env && { env }),
  });

  const client = new Client({ name: "benchmark-agent", version: "1.0.0" });

  metrics.beginSetup();
  await client.connect(transport);
  const { tools: mcpTools } = await client.listTools();
  metrics.endSetup();

  const geminiTools = mcpTools.map((t): FunctionDeclaration => ({
    name: t.name,
    description: t.description ?? "",
    parameters: convertToGeminiSchema(t.inputSchema),
  }));

  const model = genAI.getGenerativeModel({
    model: geminiModel,
    tools: [{ functionDeclarations: geminiTools }],
  });

  const chat = model.startChat({
    history: [
      {
        role: "user",
        parts: [
          {
            text: 'You are an issue tracker agent. You have access to tools to interact with repositories, issues, and comments. You have NO prior knowledge of the data — use the tools to discover the current state. When done, respond with "DONE".',
          },
        ],
      },
    ],
  });

  metrics.beginStep("agent_loop");

  verbose("mcp", "Sending task prompt");
  let response = await chat.sendMessage(scenario.agentPrompt);
  llmCalls++;
  if (response.response.usageMetadata) {
    inputTokens += response.response.usageMetadata.promptTokenCount ?? 0;
    outputTokens += response.response.usageMetadata.candidatesTokenCount ?? 0;
  }

  let maxIterations = 20;
  while (maxIterations-- > 0) {
    const parts = response.response.candidates?.[0]?.content?.parts ?? [];
    const fnCalls = parts.filter((p) => "functionCall" in p);
    const textParts = parts.filter((p) => "text" in p).map((p) => (p as any).text).join("");

    if (textParts) verboseLlmTurn("mcp", llmCalls, textParts);

    if (fnCalls.length === 0) {
      verbose("mcp", "Agent finished (no more tool calls)");
      break;
    }

    const fnResults: { functionResponse: { name: string; response: any } }[] = [];

    for (const part of fnCalls) {
      const fc = (part as any).functionCall;
      toolCalls++;
      verboseToolCall("mcp", fc.name, fc.args);
      const result = await client.callTool({ name: fc.name, arguments: fc.args ?? {} });
      const resultText = (result.content as any[])
        ?.filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("") ?? "";
      metrics.recordSend(JSON.stringify({ name: fc.name, arguments: fc.args }).length);
      metrics.recordReceive(resultText.length);

      let parsed: any;
      try {
        parsed = JSON.parse(resultText);
      } catch {
        parsed = { text: resultText };
      }
      const responseObj = Array.isArray(parsed) ? { results: parsed } : (typeof parsed === "object" && parsed !== null ? parsed : { value: parsed });
      verboseToolResult("mcp", fc.name, responseObj);
      fnResults.push({
        functionResponse: { name: fc.name, response: responseObj },
      });
    }

    response = await chat.sendMessage(fnResults);
    llmCalls++;
    if (response.response.usageMetadata) {
      inputTokens += response.response.usageMetadata.promptTokenCount ?? 0;
      outputTokens += response.response.usageMetadata.candidatesTokenCount ?? 0;
    }
  }

  metrics.endStep();

  // Verify correctness via MCP tool calls (not counted in metrics)
  let verification: VerificationSummary | undefined;
  if (scenario.verify) {
    verbose("mcp", "Running verification...");
    verification = await verifyViaMcp(client, scenario);
  }

  await client.close();

  const base = metrics.toMetrics();
  return {
    ...base,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    toolCalls,
    llmCalls,
    estimatedCostUsd: estimateCost(inputTokens, outputTokens),
    verification,
  };
}

/**
 * Verify MCP agent results by querying the MCP server's state via tools.
 * Rebuilds a partial store view from tool responses for verification.
 */
async function verifyViaMcp(client: Client, scenario: Scenario): Promise<VerificationSummary> {
  // Build a temporary store from MCP queries to run the same verify function
  const tempStore = new IssueTrackerStore();

  // Fetch all repos
  const repoResult = await client.callTool({ name: "list_repos", arguments: {} });
  const repoText = (repoResult.content as any[])?.find((c: any) => c.type === "text")?.text ?? "[]";
  const repos = JSON.parse(repoText);
  tempStore.repos = repos;

  // Fetch all issues per repo
  for (const repo of repos) {
    const issueResult = await client.callTool({ name: "list_issues", arguments: { repo_id: repo.id } });
    const issueText = (issueResult.content as any[])?.find((c: any) => c.type === "text")?.text ?? "[]";
    const issues = JSON.parse(issueText);
    tempStore.issues.push(...issues);
  }

  // Fetch comments for issues that need them
  for (const issue of tempStore.issues) {
    const commentResult = await client.callTool({ name: "list_comments", arguments: { issue_id: issue.id } });
    const commentText = (commentResult.content as any[])?.find((c: any) => c.type === "text")?.text ?? "[]";
    const comments = JSON.parse(commentText);
    tempStore.comments.push(...comments);
  }

  const result = scenario.verify!(tempStore);
  return toSummary(result, "mcp");
}

function toSummary(result: VerificationResult, protocol?: string): VerificationSummary {
  if (protocol) {
    for (const check of result.checks) {
      verboseVerification(protocol, check.passed, `${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
    }
  }
  return {
    passed: result.passed,
    totalChecks: result.checks.length,
    passedChecks: result.checks.filter((c) => c.passed).length,
    failures: result.checks
      .filter((c) => !c.passed)
      .map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`),
  };
}

function convertToGeminiSchema(schema: any): any {
  if (!schema || typeof schema !== "object") {
    return { type: SchemaType.OBJECT, properties: {} };
  }

  const result: any = {};

  if (schema.type === "object") {
    result.type = SchemaType.OBJECT;
    if (schema.properties) {
      result.properties = {};
      for (const [key, value] of Object.entries(schema.properties)) {
        const prop = value as any;
        if (prop.type === "string") {
          result.properties[key] = {
            type: SchemaType.STRING,
            description: prop.description ?? "",
          };
          if (prop.enum) result.properties[key].enum = prop.enum;
        } else if (prop.type === "number" || prop.type === "integer") {
          result.properties[key] = {
            type: SchemaType.NUMBER,
            description: prop.description ?? "",
          };
        } else if (prop.type === "boolean") {
          result.properties[key] = {
            type: SchemaType.BOOLEAN,
            description: prop.description ?? "",
          };
        } else if (prop === "string") {
          result.properties[key] = {
            type: SchemaType.STRING,
            description: key,
          };
        } else {
          result.properties[key] = {
            type: SchemaType.STRING,
            description: prop.description ?? key,
          };
        }
      }
    }
    if (schema.required) {
      result.required = schema.required;
    }
  } else {
    result.type = SchemaType.OBJECT;
    result.properties = {};
  }

  return result;
}
