import type { CellMetrics, RunRecord } from "../runner/types.ts";

/**
 * Failure taxonomy — why did this run fall short? A run may land in multiple
 * buckets (max_turns *and* verification failure) so we return a set.
 *
 * Categories:
 * - `ok`                 — passed verification cleanly
 * - `no_verifier`        — scenario has no verifier; we can't score it
 * - `verify_fail`        — verifier returned passed=false
 * - `max_turns`          — ran out of budget before finishing
 * - `tool_unknown`       — agent called a tool that didn't exist on the tree at that moment
 * - `tool_invoke_error`  — affordance was valid but invoke() threw
 * - `tool_param_error`   — affordance was valid but args were malformed
 * - `cell_exception`     — runner itself threw (network, server crash, …)
 */
export type FailureCategory =
  | "ok"
  | "no_verifier"
  | "verify_fail"
  | "max_turns"
  | "tool_unknown"
  | "tool_invoke_error"
  | "tool_param_error"
  | "cell_exception";

export function categorizeRun(record: RunRecord): FailureCategory[] {
  const cats = new Set<FailureCategory>();
  if (record.error) cats.add("cell_exception");
  const m = record.metrics;
  if (!m) return Array.from(cats);

  if (m.unknownToolCalls > 0) cats.add("tool_unknown");
  if (m.invokeErrorCalls > 0) cats.add("tool_invoke_error");
  if (m.paramErrorCalls > 0) cats.add("tool_param_error");
  if (m.finishReason === "max_turns") cats.add("max_turns");

  if (!m.verification) {
    cats.add("no_verifier");
  } else if (!m.verification.passed) {
    cats.add("verify_fail");
  }

  if (m.verification?.passed && cats.size === 0) cats.add("ok");
  if (cats.size === 0) cats.add("ok");
  return Array.from(cats);
}

export function isSuccess(record: RunRecord): boolean {
  if (record.error) return false;
  return record.metrics?.verification?.passed === true;
}

export function summarizeCategories(records: RunRecord[]): Record<FailureCategory, number> {
  const counts: Record<FailureCategory, number> = {
    ok: 0,
    no_verifier: 0,
    verify_fail: 0,
    max_turns: 0,
    tool_unknown: 0,
    tool_invoke_error: 0,
    tool_param_error: 0,
    cell_exception: 0,
  };
  for (const r of records) {
    for (const cat of categorizeRun(r)) counts[cat] += 1;
  }
  return counts;
}

export function _cellMetricsForTypeCheck(_m: CellMetrics) {
  // Exists so CellMetrics import isn't dropped — used by categorizeRun above via record.metrics.
}
