import type { Cell, RunRecord } from "../runner/types.ts";
import { estimateCostUsd } from "./cost.ts";
import { categorizeRun, isSuccess, summarizeCategories, type FailureCategory } from "./taxonomy.ts";

export interface NumericAggregate {
  count: number;
  mean: number;
  median: number;
  p95: number;
  stdev: number;
  min: number;
  max: number;
  /** Bootstrap 95% CI on the mean. null if too few samples to bootstrap. */
  ci95?: [number, number];
}

export interface CellAggregate {
  cellId: string;
  cell: Cell;
  runs: number;
  passRate: number;
  failureCategories: Record<FailureCategory, number>;
  totalTokens: NumericAggregate;
  inputTokens: NumericAggregate;
  outputTokens: NumericAggregate;
  maxContextTokens: NumericAggregate;
  turns: NumericAggregate;
  toolCalls: NumericAggregate;
  specComplianceRate: NumericAggregate;
  llmTimeMs: NumericAggregate;
  totalTimeMs: NumericAggregate;
  timeToFirstToolCallMs: NumericAggregate;
  transportBytes: NumericAggregate;
  costUsd: NumericAggregate;
  /** Cost per successful run. Infinity when passRate is 0. */
  costPerSuccess: number;
  /** Tokens per successful run. */
  tokensPerSuccess: number;
}

export function aggregateCells(runs: RunRecord[]): CellAggregate[] {
  // Dedup by runId, preferring successful records over errored ones. This
  // handles resume-after-fix: when a cell errored, got fixed, and re-ran,
  // the jsonl ends up with two records sharing the same runId — one ERR,
  // one PASS. Count the PASS and drop the ERR.
  const byRunId = new Map<string, RunRecord>();
  for (const r of runs) {
    if (!r.runId) continue;
    const existing = byRunId.get(r.runId);
    if (!existing) {
      byRunId.set(r.runId, r);
      continue;
    }
    const existingHasMetrics = !!existing.metrics && !existing.error;
    const currentHasMetrics = !!r.metrics && !r.error;
    if (!existingHasMetrics && currentHasMetrics) byRunId.set(r.runId, r);
  }

  const buckets = new Map<string, RunRecord[]>();
  for (const r of byRunId.values()) {
    if (!r.cellId) continue;
    const bucket = buckets.get(r.cellId) ?? [];
    bucket.push(r);
    buckets.set(r.cellId, bucket);
  }

  const out: CellAggregate[] = [];
  for (const [cellId, cellRuns] of buckets) {
    const first = cellRuns[0];
    const metrics = cellRuns.map((r) => r.metrics).filter((m): m is NonNullable<typeof m> => !!m);
    const passCount = cellRuns.filter(isSuccess).length;
    const passRate = cellRuns.length > 0 ? passCount / cellRuns.length : 0;

    const agg = (pick: (m: (typeof metrics)[number]) => number): NumericAggregate =>
      numericAggregate(metrics.map(pick));

    const cell = first.cell;
    const total = agg((m) => m.totalTokens);
    const cost = agg((m) => estimateCostUsd(cell.provider, m.inputTokens, m.outputTokens));

    out.push({
      cellId,
      cell,
      runs: cellRuns.length,
      passRate,
      failureCategories: summarizeCategories(cellRuns),
      totalTokens: total,
      inputTokens: agg((m) => m.inputTokens),
      outputTokens: agg((m) => m.outputTokens),
      maxContextTokens: agg((m) => m.maxContextTokens),
      turns: agg((m) => m.turns),
      toolCalls: agg((m) => m.toolCalls),
      specComplianceRate: agg((m) => m.specComplianceRate),
      llmTimeMs: agg((m) => m.llmTimeMs),
      totalTimeMs: agg((m) => m.totalTimeMs),
      timeToFirstToolCallMs: agg((m) => m.timeToFirstToolCallMs ?? Number.NaN),
      transportBytes: agg((m) => m.transportBytesSent + m.transportBytesReceived),
      costUsd: cost,
      costPerSuccess: passCount > 0 ? (cost.mean * cellRuns.length) / passCount : Number.POSITIVE_INFINITY,
      tokensPerSuccess: passCount > 0 ? (total.mean * cellRuns.length) / passCount : Number.POSITIVE_INFINITY,
    });
  }
  return out;
}

export function numericAggregate(raw: number[]): NumericAggregate {
  const values = raw.filter((v) => Number.isFinite(v));
  const count = values.length;
  if (count === 0) {
    return { count: 0, mean: 0, median: 0, p95: 0, stdev: 0, min: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / count;
  const median = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const stdev = count > 1 ? Math.sqrt(values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (count - 1)) : 0;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const agg: NumericAggregate = { count, mean, median, p95, stdev, min, max };
  if (count >= 5) agg.ci95 = bootstrapCiMean(values);
  return agg;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Nonparametric bootstrap 95% CI for the mean. Resamples with replacement
 * 2000 times. Good enough for a dev-facing dashboard; swap in BCa later if we
 * need bias correction.
 */
function bootstrapCiMean(values: number[]): [number, number] {
  const B = 2000;
  const means: number[] = new Array(B);
  const n = values.length;
  for (let b = 0; b < B; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[(Math.random() * n) | 0];
    means[b] = sum / n;
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(B * 0.025)], means[Math.floor(B * 0.975)]];
}

/**
 * Welch's t-test on two independent samples. Returns t and an approximate
 * two-sided p-value using a normal approximation when either sample is
 * small enough that the full t-distribution matters less than the rough
 * signal. Good enough to colour dashboard rows; not good enough to publish.
 */
export function welchTTest(a: number[], b: number[]): { t: number; pTwoSided: number } | null {
  const na = a.length;
  const nb = b.length;
  if (na < 2 || nb < 2) return null;
  const meanA = a.reduce((x, y) => x + y, 0) / na;
  const meanB = b.reduce((x, y) => x + y, 0) / nb;
  const varA = a.reduce((acc, v) => acc + (v - meanA) ** 2, 0) / (na - 1);
  const varB = b.reduce((acc, v) => acc + (v - meanB) ** 2, 0) / (nb - 1);
  const se = Math.sqrt(varA / na + varB / nb);
  if (se === 0) return { t: 0, pTwoSided: 1 };
  const t = (meanA - meanB) / se;
  // Normal approximation to the two-sided p-value.
  const pTwoSided = 2 * (1 - phi(Math.abs(t)));
  return { t, pTwoSided };
}

function phi(x: number): number {
  // Abramowitz & Stegun 7.1.26 approximation for standard normal CDF.
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

export function loadRuns(lines: string[]): RunRecord[] {
  const out: RunRecord[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === "object" && "cellId" in obj) out.push(obj as RunRecord);
  }
  return out;
}

export function categoryCounts(records: RunRecord[]) {
  const out: Record<string, number> = {};
  for (const r of records) {
    for (const c of categorizeRun(r)) out[c] = (out[c] ?? 0) + 1;
  }
  return out;
}
