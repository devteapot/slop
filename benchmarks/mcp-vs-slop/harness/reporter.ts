import type { BenchmarkReport, ScenarioResult, ProtocolMetrics, AgentMetrics, ProtocolLabel } from "./types";
import { MODEL_PRICING } from "./types";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatCost(usd: number): string {
  if (usd < 0.001) return `$${(usd * 1000).toFixed(3)}m`;
  return `$${usd.toFixed(4)}`;
}

function delta(value: number, baseline: number): string {
  if (baseline === 0) return "N/A";
  const pct = ((value - baseline) / baseline) * 100;
  const sign = pct <= 0 ? "" : "+";
  return `${sign}${pct.toFixed(0)}%`;
}

function pad(s: string, len: number): string {
  return s.padEnd(len);
}

function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length), 8),
  );
  const lines: string[] = [];

  lines.push(`| ${headers.map((h, i) => pad(h, widths[i])).join(" | ")} |`);
  lines.push(`|${widths.map((w) => "-".repeat(w + 2)).join("|")}|`);
  for (const row of rows) {
    lines.push(`| ${row.map((c, i) => pad(c ?? "", widths[i])).join(" | ")} |`);
  }

  return lines.join("\n");
}

const LABEL_MAP: Record<ProtocolLabel, string> = {
  mcp: "MCP",
  slop: "SLOP",
  "slop-optimized": "SLOP (opt)",
  "slop-basic": "SLOP (basic)",
};

function renderScenario(result: ScenarioResult): string {
  const lines: string[] = [];
  const protocols = result.results;
  const baseline = protocols.find((p) => p.protocol === "mcp") ?? protocols[0];

  lines.push(`### ${result.scenario} (${result.mode})`);
  lines.push("");

  // Verification summary (agent mode)
  const hasVerification = protocols.some((p) => "verification" in p && (p as AgentMetrics).verification);
  if (hasVerification) {
    const verHeaders = ["Protocol", "Result", "Checks", "Failures"];
    const verRows: string[][] = [];
    for (const p of protocols) {
      const v = (p as AgentMetrics).verification;
      if (v) {
        verRows.push([
          LABEL_MAP[p.protocol] ?? p.protocol,
          v.passed ? "PASS" : "FAIL",
          `${v.passedChecks}/${v.totalChecks}`,
          v.failures.length > 0 ? v.failures.join("; ") : "-",
        ]);
      }
    }
    lines.push(renderTable(verHeaders, verRows));
    lines.push("");
  }

  const headers = ["Metric", ...protocols.map((p) => LABEL_MAP[p.protocol] ?? p.protocol)];
  if (protocols.length > 1) headers.push("vs MCP");

  const makeRow = (
    label: string,
    getter: (m: ProtocolMetrics) => number,
    fmt: (n: number) => string = String,
  ): string[] => {
    const values = protocols.map((p) => fmt(getter(p)));
    const row = [label, ...values];
    if (protocols.length > 1) {
      const nonMcp = protocols.filter((p) => p.protocol !== "mcp");
      const best = nonMcp.reduce(
        (min, p) => (getter(p) < getter(min) ? p : min),
        nonMcp[0],
      );
      if (best && baseline.protocol === "mcp") {
        row.push(delta(getter(best), getter(baseline)));
      } else {
        row.push("");
      }
    }
    return row;
  };

  const rows: string[][] = [
    makeRow("Messages sent", (m) => m.totalMessagesSent),
    makeRow("Messages received", (m) => m.totalMessagesReceived),
    makeRow("Bytes sent", (m) => m.totalBytesSent, formatBytes),
    makeRow("Bytes received", (m) => m.totalBytesReceived, formatBytes),
    makeRow("Total payload", (m) => m.totalBytesSent + m.totalBytesReceived, formatBytes),
    makeRow("Setup time (ms)", (m) => m.setupTimeMs),
    makeRow("Total time (ms)", (m) => m.totalTimeMs),
  ];

  const hasAgent = protocols.every((p) => "inputTokens" in p);
  if (hasAgent) {
    const ag = (m: ProtocolMetrics) => m as AgentMetrics;
    rows.push(
      makeRow("Input tokens", (m) => ag(m).inputTokens),
      makeRow("Output tokens", (m) => ag(m).outputTokens),
      makeRow("Total tokens", (m) => ag(m).totalTokens),
      makeRow("Tool calls", (m) => ag(m).toolCalls),
      makeRow("LLM round trips", (m) => ag(m).llmCalls),
      makeRow("Est. cost (USD)", (m) => ag(m).estimatedCostUsd, formatCost),
    );
  }

  lines.push(renderTable(headers, rows));

  // Step breakdown
  lines.push("");
  lines.push("<details><summary>Step breakdown</summary>\n");
  const stepHeaders = ["Step", ...protocols.map((p) => `${LABEL_MAP[p.protocol] ?? p.protocol} (ms)`)];
  const maxSteps = Math.max(...protocols.map((p) => p.steps.length));
  const stepRows: string[][] = [];
  for (let i = 0; i < maxSteps; i++) {
    const row = [protocols.find((p) => p.steps[i])?.steps[i]?.step ?? ""];
    for (const p of protocols) {
      row.push(p.steps[i] ? String(p.steps[i].durationMs) : "-");
    }
    stepRows.push(row);
  }
  lines.push(renderTable(stepHeaders, stepRows));
  lines.push("\n</details>");

  // Verification details (if any failures)
  if (hasVerification) {
    const anyFailures = protocols.some((p) => {
      const v = (p as AgentMetrics).verification;
      return v && !v.passed;
    });
    if (anyFailures) {
      lines.push("");
      lines.push("<details><summary>Verification failures</summary>\n");
      for (const p of protocols) {
        const v = (p as AgentMetrics).verification;
        if (v && !v.passed) {
          lines.push(`**${LABEL_MAP[p.protocol] ?? p.protocol}:**`);
          for (const f of v.failures) {
            lines.push(`- ${f}`);
          }
          lines.push("");
        }
      }
      lines.push("</details>");
    }
  }

  return lines.join("\n");
}

export function generateReport(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push("# MCP vs SLOP Benchmark Results");
  lines.push("");
  lines.push(`**Date:** ${report.timestamp}`);
  lines.push(`**Platform:** ${report.platform}`);
  lines.push(`**Mode:** ${report.mode}`);
  lines.push(`**Iterations:** ${report.iterations}`);
  const hasAgent = report.scenarios.some((s) => s.results.some((r) => "inputTokens" in r));
  if (hasAgent) {
    const p = MODEL_PRICING[report.model] ?? { inputPerMillion: "?", outputPerMillion: "?" };
    lines.push(`**Model:** ${report.model} ($${p.inputPerMillion}/M input, $${p.outputPerMillion}/M output)`);
  }
  lines.push("");

  for (const scenario of report.scenarios) {
    lines.push(renderScenario(scenario));
    lines.push("");
  }

  return lines.join("\n");
}

export function writeReport(report: BenchmarkReport, outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });

  const markdown = generateReport(report);
  writeFileSync(join(outputDir, "latest.md"), markdown);
  writeFileSync(join(outputDir, "latest.json"), JSON.stringify(report, null, 2));

  console.log(markdown);
}
