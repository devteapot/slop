import { SlopConsumer, WebSocketClientTransport } from "@slop-ai/consumer";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { IssueTrackerStore } from "../app/store";
import { createSeedData, createLargeSeedData } from "../app/seed";
import { startSlopServer } from "../app/slop-server";
import { MetricsCollector } from "./metrics";
import type { ScenarioResult, ProtocolMetrics, ProtocolLabel } from "./types";
import type { Scenario } from "../scenarios/types";

const SLOP_PORT = 4199;

export async function runScriptedBenchmark(
  scenarios: Scenario[],
  iterations: number,
  protocolFilter?: Set<string> | null,
): Promise<ScenarioResult[]> {
  const shouldRun = (proto: string) => !protocolFilter || protocolFilter.has(proto);
  const results: ScenarioResult[] = [];

  for (const scenario of scenarios) {
    console.log(`\n  Running scenario: ${scenario.name}${scenario.largeDataset ? " (large dataset)" : ""}`);
    const seed = scenario.largeDataset ? createLargeSeedData() : createSeedData();
    const runs: Partial<Record<ProtocolLabel, ProtocolMetrics[]>> = {};

    for (let i = 0; i < iterations; i++) {
      process.stdout.write(`    Iteration ${i + 1}/${iterations}...`);

      if (shouldRun("slop")) {
        if (!runs.slop) runs.slop = [];
        const store = new IssueTrackerStore();
        store.reset(seed);
        const { server, slop } = startSlopServer(store, SLOP_PORT);
        try {
          runs.slop.push(await runSlopScenario(scenario, SLOP_PORT, "slop", -1));
        } finally {
          slop.stop();
          server.stop();
        }
      }

      if (shouldRun("slop-optimized")) {
        if (!runs["slop-optimized"]) runs["slop-optimized"] = [];
        const store = new IssueTrackerStore();
        store.reset(seed);
        const { server, slop } = startSlopServer(store, SLOP_PORT, { optimized: true });
        try {
          runs["slop-optimized"].push(await runSlopScenario(scenario, SLOP_PORT, "slop-optimized", -1));
        } finally {
          slop.stop();
          server.stop();
        }
      }

      if (shouldRun("mcp")) {
        if (!runs.mcp) runs.mcp = [];
        runs.mcp.push(await runMcpScenario(scenario));
      }

      console.log(" done");
    }

    const protocolResults: ProtocolMetrics[] = [];
    if (runs.mcp) protocolResults.push(averageMetrics(runs.mcp));
    if (runs.slop) protocolResults.push(averageMetrics(runs.slop));
    if (runs["slop-optimized"]) protocolResults.push(averageMetrics(runs["slop-optimized"]));

    results.push({
      scenario: scenario.name,
      mode: "scripted",
      results: protocolResults,
    });
  }

  return results;
}

async function runSlopScenario(
  scenario: Scenario,
  port: number,
  label: ProtocolLabel,
  depth: number,
): Promise<ProtocolMetrics> {
  const metrics = new MetricsCollector(label);
  const transport = new WebSocketClientTransport(`ws://localhost:${port}/slop`);

  const origConnect = transport.connect.bind(transport);
  transport.connect = async () => {
    const conn = await origConnect();
    const origSend = conn.send.bind(conn);
    conn.send = (msg: any) => {
      const data = JSON.stringify(msg);
      metrics.recordSend(new TextEncoder().encode(data).length);
      return origSend(msg);
    };
    const origOnMessage = conn.onMessage.bind(conn);
    conn.onMessage = (handler: any) => {
      return origOnMessage((msg: any) => {
        const data = JSON.stringify(msg);
        metrics.recordReceive(new TextEncoder().encode(data).length);
        handler(msg);
      });
    };
    return conn;
  };

  const consumer = new SlopConsumer(transport);

  metrics.beginSetup();
  await consumer.connect();
  metrics.endSetup();

  metrics.beginStep("subscribe");
  const { id: subId, snapshot } = await consumer.subscribe("/", depth);
  metrics.endStep();

  for (const step of scenario.steps) {
    metrics.beginStep(step.name);
    await step.slop(consumer, subId, snapshot);
    metrics.endStep();
  }

  consumer.disconnect();
  return metrics.toMetrics();
}

async function runMcpScenario(scenario: Scenario): Promise<ProtocolMetrics> {
  const metrics = new MetricsCollector("mcp");

  const env = scenario.largeDataset ? { ...process.env, BENCH_LARGE_DATASET: "1" } : undefined;
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", `${import.meta.dir}/../app/mcp-server.ts`],
    ...(env && { env }),
  });

  const origStart = transport.start.bind(transport);
  transport.start = async () => {
    await origStart();
    const proc = (transport as any)._process;
    if (proc?.stdin) {
      const origWrite = proc.stdin.write.bind(proc.stdin);
      proc.stdin.write = (data: any, ...rest: any[]) => {
        const bytes = typeof data === "string" ? new TextEncoder().encode(data).length : data.length;
        metrics.recordSend(bytes);
        return origWrite(data, ...rest);
      };
    }
    if (proc?.stdout) {
      proc.stdout.on("data", (data: Buffer) => {
        metrics.recordReceive(data.length);
      });
    }
  };

  const client = new Client({ name: "benchmark-client", version: "1.0.0" });

  metrics.beginSetup();
  await client.connect(transport);
  metrics.endSetup();

  metrics.beginStep("list_tools");
  await client.listTools();
  metrics.endStep();

  for (const step of scenario.steps) {
    metrics.beginStep(step.name);
    await step.mcp(client);
    metrics.endStep();
  }

  await client.close();
  return metrics.toMetrics();
}

function averageMetrics(runs: ProtocolMetrics[]): ProtocolMetrics {
  if (runs.length === 1) return runs[0];

  const avg = (arr: number[]) => Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;

  return {
    protocol: runs[0].protocol,
    setupTimeMs: avg(runs.map((r) => r.setupTimeMs)),
    totalTimeMs: avg(runs.map((r) => r.totalTimeMs)),
    totalBytesSent: avg(runs.map((r) => r.totalBytesSent)),
    totalBytesReceived: avg(runs.map((r) => r.totalBytesReceived)),
    totalMessagesSent: avg(runs.map((r) => r.totalMessagesSent)),
    totalMessagesReceived: avg(runs.map((r) => r.totalMessagesReceived)),
    steps: runs[runs.length - 1].steps,
  };
}
