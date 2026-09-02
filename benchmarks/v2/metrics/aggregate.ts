import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { aggregateCells, loadRuns, type CellAggregate, type NumericAggregate } from "./stats.ts";
import { cellLabel } from "../runner/hash.ts";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

const input = values.input;
if (!input) {
  console.error("usage: bun run metrics/aggregate.ts --input results/<sweep-id>/runs.jsonl [--json]");
  process.exit(1);
}

const raw = readFileSync(input, "utf8").split("\n");
const records = loadRuns(raw);
if (records.length === 0) {
  console.error(`no run records found in ${input}`);
  process.exit(1);
}
const aggregates = aggregateCells(records);

if (values.json) {
  const out = join(dirname(input), "aggregated.json");
  writeFileSync(out, JSON.stringify({ source: input, runs: records.length, cells: aggregates }, null, 2));
  console.log(`wrote ${out}`);
}

printTable(aggregates);

function printTable(cells: CellAggregate[]) {
  cells.sort((a, b) => a.cellId.localeCompare(b.cellId));
  const header = [
    "cell".padEnd(18),
    "N".padStart(3),
    "pass%".padStart(6),
    "tok̄".padStart(7),
    "tok₉₅".padStart(7),
    "ctxMx".padStart(6),
    "turns̄".padStart(7),
    "calls̄".padStart(7),
    "spec%".padStart(6),
    "t̄(s)".padStart(6),
    "$/✓".padStart(8),
    "tok/✓".padStart(9),
    "label",
  ];
  console.log(header.join(" "));
  for (const c of cells) {
    const passPct = `${(c.passRate * 100).toFixed(0)}%`;
    const specPct = `${(c.specComplianceRate.mean * 100).toFixed(0)}%`;
    const label = cellLabel({ ...c.cell, iteration: 0 }).replace(` | iter=0`, "");
    console.log(
      [
        c.cellId.slice(0, 16).padEnd(18),
        String(c.runs).padStart(3),
        passPct.padStart(6),
        fmt(c.totalTokens, 0).padStart(7),
        fmt95(c.totalTokens).padStart(7),
        fmtNum(c.maxContextTokens.mean, 0).padStart(6),
        fmt(c.turns, 1).padStart(7),
        fmt(c.toolCalls, 1).padStart(7),
        specPct.padStart(6),
        fmtNum(c.totalTimeMs.mean / 1000, 1).padStart(6),
        fmtCost(c.costPerSuccess).padStart(8),
        fmtNum(c.tokensPerSuccess, 0).padStart(9),
        label,
      ].join(" "),
    );
  }
  const totals = {
    runs: records.length,
    pass: records.filter((r) => r.metrics?.verification?.passed).length,
  };
  const passRate = totals.runs > 0 ? (totals.pass / totals.runs) * 100 : 0;
  console.log(`\n${totals.runs} runs, ${totals.pass} pass (${passRate.toFixed(0)}%), ${cells.length} unique cells`);
}

function fmt(agg: NumericAggregate, digits: number): string {
  if (agg.count === 0) return "–";
  return agg.mean.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmt95(agg: NumericAggregate): string {
  if (agg.count === 0) return "–";
  return agg.p95.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtNum(n: number, digits: number): string {
  if (!Number.isFinite(n)) return "–";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtCost(n: number): string {
  if (!Number.isFinite(n)) return "∞";
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}
