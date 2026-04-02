import { parseArgs } from "util";
import { exploreAndAct } from "./scenarios/explore-and-act";
import { triage } from "./scenarios/triage";
import { bulkUpdate } from "./scenarios/bulk-update";
import { scaleTriage } from "./scenarios/scale-triage";
import { negative } from "./scenarios/negative";
import { contextual } from "./scenarios/contextual";
import { recovery } from "./scenarios/recovery";
import { stateTransitions } from "./scenarios/state-transitions";
import { crossEntity } from "./scenarios/cross-entity";
import { conditional } from "./scenarios/conditional";
import { ambiguity } from "./scenarios/ambiguity";
import { complexWorkflow } from "./scenarios/complex-workflow";
import { runScriptedBenchmark } from "./harness/scripted-runner";
import { runAgentBenchmark, setGeminiModel } from "./harness/agent-runner";
import { writeReport } from "./harness/reporter";
import { setVerbose } from "./harness/logger";
import type { BenchmarkReport, ScenarioResult } from "./harness/types";
import { join } from "node:path";

type BenchmarkMode = "scripted" | "agent" | "all";

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "scripted" },
    scenario: { type: "string", default: "all" },
    protocol: { type: "string", default: "all" },
    iterations: { type: "string", default: "3" },
    model: { type: "string", default: "gemini-2.5-flash" },
    verbose: { type: "boolean", default: false },
  },
});

const mode = parseMode(values.mode);
const iterations = parseInt(values.iterations!, 10);
const model = values.model!;
setGeminiModel(model);
setVerbose(values.verbose!);

// Parse protocol filter: "all", or comma-separated: "mcp,slop-optimized"
const protocolFilter = values.protocol!;
const selectedProtocols: Set<string> | null =
  protocolFilter === "all"
    ? null
    : new Set(protocolFilter.split(",").map((s) => s.trim()));

const allScenarios = [
  exploreAndAct, triage, bulkUpdate, scaleTriage,
  negative, contextual, recovery,
  stateTransitions, crossEntity, conditional, ambiguity,
  complexWorkflow,
];

// Support comma-separated scenario names: --scenario triage,negative,recovery
const scenarioFilter = values.scenario!;
const selectedScenarios =
  scenarioFilter === "all"
    ? allScenarios
    : (() => {
        const names = scenarioFilter.split(",").map((s) => s.trim());
        const matched = allScenarios.filter((s) => names.includes(s.name));
        return matched;
      })();

if (selectedScenarios.length === 0) {
  console.error(`Unknown scenario: ${values.scenario}`);
  console.error(`Available: ${allScenarios.map((s) => s.name).join(", ")}`);
  process.exit(1);
}

console.log("MCP vs SLOP Benchmark");
console.log("=====================");
console.log(`Mode: ${mode}`);
console.log(`Model: ${model}`);
console.log(`Scenarios: ${selectedScenarios.map((s) => s.name).join(", ")}`);
console.log(`Iterations: ${iterations}`);

const results: ScenarioResult[] = [];

if (mode === "scripted" || mode === "all") {
  console.log("\n--- Scripted Mode ---");
  const scripted = await runScriptedBenchmark(selectedScenarios, iterations, selectedProtocols);
  results.push(...scripted);
}

if (mode === "agent" || mode === "all") {
  console.log("\n--- Agent Mode ---");
  const agent = await runAgentBenchmark(selectedScenarios, selectedProtocols, iterations);
  results.push(...agent);
}

const report: BenchmarkReport = {
  timestamp: new Date().toISOString(),
  platform: `${process.platform} ${process.arch}`,
  mode,
  model,
  iterations,
  scenarios: results,
};

writeReport(report, join(import.meta.dir, "results"));

function parseMode(value: string | undefined): BenchmarkMode {
  return value === "agent" || value === "all" ? value : "scripted";
}
