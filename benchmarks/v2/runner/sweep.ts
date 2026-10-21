import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmProvider } from "../providers/types.ts";
import { OpenAICompatProvider } from "../providers/openai-compat.ts";
import { resolveApp } from "../apps/registry.ts";
import { runSlopCell } from "./slop-cell.ts";
import { runMcpCell } from "./mcp-cell.ts";
import { cellLabel, configHash, runId } from "./hash.ts";
import { JsonlWriter } from "./jsonl.ts";
import type { Cell, ProviderConfig, RunRecord, SweepConfig } from "./types.ts";

const BASE_PORT = 4198;

export interface SweepRunOptions {
  resultsRoot?: string;
  dryRun?: boolean;
  /** Truncate existing runs.jsonl and start over. Default: resume if data exists. */
  fresh?: boolean;
  onRecord?: (record: RunRecord) => void;
}

export async function runSweep(sweep: SweepConfig, opts: SweepRunOptions = {}) {
  const resultsRoot = opts.resultsRoot ?? join(import.meta.dir, "..", "results");
  const outDir = join(resultsRoot, sweep.id);
  const jsonlPath = join(outDir, "runs.jsonl");

  // Resume: scan existing runs.jsonl (if any) and collect completed run IDs.
  // A cell is considered "done" when a record with its runId and no `error`
  // field is present. Errored cells are retried on resume.
  const completedRunIds = new Set<string>();
  let appending = false;
  if (!opts.fresh && existsSync(jsonlPath)) {
    try {
      const raw = readFileSync(jsonlPath, "utf8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const rec = JSON.parse(line) as Partial<RunRecord> & { runId?: string; error?: string };
          if (rec.runId && !rec.error && rec.metrics) completedRunIds.add(rec.runId);
        } catch {
          // Ignore malformed lines
        }
      }
      if (completedRunIds.size > 0) {
        appending = true;
        console.log(`[sweep] resume: ${completedRunIds.size} completed runs already recorded, appending`);
      }
    } catch (err) {
      console.warn(`[sweep] resume: failed to read ${jsonlPath}: ${err}`);
    }
  }

  const writer = new JsonlWriter(jsonlPath, { append: appending });
  writer.open();
  if (!appending) {
    writer.write({ type: "sweep", config: sweep, startedAt: new Date().toISOString() });
  }

  const cells = expand(sweep);
  console.log(`[sweep] ${sweep.id}: ${cells.length} cells`);

  if (opts.dryRun) {
    for (const cell of cells) {
      const h = configHash(sweep, cell);
      console.log(`[dry] ${h} ${cellLabel(cell)}`);
    }
    await writer.close();
    return { cells, recorded: 0 };
  }

  const providerCache = new Map<string, LlmProvider>();
  let done = 0;
  let skipped = 0;
  let portCursor = BASE_PORT;

  for (const cell of cells) {
    const h = configHash(sweep, cell);
    const id = runId(sweep.id, cell, h);
    if (completedRunIds.has(id)) {
      skipped += 1;
      done += 1;
      console.log(`[${done}/${cells.length}] SKIP ${h} ${cellLabel(cell)}`);
      continue;
    }
    const startedAt = new Date().toISOString();
    const t0 = performance.now();

    let record: RunRecord = {
      sweepId: sweep.id,
      cellId: h,
      runId: id,
      configHash: h,
      cell,
      startedAt,
      durationMs: 0,
    };

    try {
      const provider = getOrCreateProvider(providerCache, cell.provider);
      const port = portCursor++;

      if (cell.protocol === "slop") {
        const metrics = await runSlopCell({ cell, sweep, provider, port });
        record.metrics = metrics;
      } else if (cell.protocol === "mcp") {
        const metrics = await runMcpCell({ cell, sweep, provider });
        record.metrics = metrics;
      } else {
        throw new Error(`Unknown protocol: ${cell.protocol}`);
      }
    } catch (err) {
      record.error = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    } finally {
      record.durationMs = performance.now() - t0;
    }

    writer.write(record);
    opts.onRecord?.(record);
    done += 1;

    const status = record.error
      ? "ERR"
      : record.metrics?.verification
        ? record.metrics.verification.passed
          ? "PASS"
          : "FAIL"
        : "—";
    console.log(
      `[${done}/${cells.length}] ${status} ${h} t=${record.durationMs.toFixed(0)}ms ${cellLabel(cell)}`,
    );
  }

  await writer.close();
  if (skipped > 0) console.log(`[sweep] done: ${done - skipped} ran, ${skipped} resumed`);
  return { cells, recorded: done, skipped };
}

function expand(sweep: SweepConfig): Cell[] {
  const cells: Cell[] = [];
  const appFilter = sweep.apps;
  for (const appId of appFilter) {
    const app = resolveApp(appId);
    const scales = sweep.dataScales.filter((s) => app.supportedScales.includes(s));
    if (scales.length === 0) {
      console.warn(`[sweep] app ${appId}: no supported scales in ${JSON.stringify(sweep.dataScales)} (supported: ${app.supportedScales.join(", ")})`);
      continue;
    }
    const scenarios = (sweep.scenarioFilter && sweep.scenarioFilter.length > 0
      ? app.scenarios.filter((s) => sweep.scenarioFilter!.includes(s.name))
      : app.scenarios);
    if (scenarios.length === 0) {
      console.warn(`[sweep] app ${appId}: no matching scenarios`);
      continue;
    }

    for (const provider of sweep.providers) {
      for (const scale of scales) {
        for (const scenario of scenarios) {
          for (const seed of sweep.seeds) {
            for (const protocol of sweep.protocols) {
              if (protocol === "slop") {
                for (const prompt of sweep.promptVariants) {
                  for (const encoding of sweep.encodingVariants) {
                    for (const optimization of sweep.optimizationVariants) {
                      for (let i = 0; i < sweep.iterations; i++) {
                        cells.push({
                          provider,
                          prompt,
                          encoding,
                          optimization,
                          protocol,
                          app: appId,
                          scale,
                          scenario: scenario.name,
                          seed,
                          iteration: i,
                        });
                      }
                    }
                  }
                }
              } else if (protocol === "mcp") {
                const variants = sweep.mcpVariants ?? ["flat"];
                for (const mcpVariant of variants) {
                  for (let i = 0; i < sweep.iterations; i++) {
                    cells.push({
                      provider,
                      prompt: "n/a",
                      encoding: "n/a",
                      optimization: "n/a",
                      protocol,
                      mcpVariant,
                      app: appId,
                      scale,
                      scenario: scenario.name,
                      seed,
                      iteration: i,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return cells;
}

function getOrCreateProvider(cache: Map<string, LlmProvider>, cfg: ProviderConfig): LlmProvider {
  const key = `${cfg.kind}|${cfg.baseUrl ?? ""}|${cfg.model}|${cfg.id ?? ""}`;
  const cached = cache.get(key);
  if (cached) return cached;
  let provider: LlmProvider;
  switch (cfg.kind) {
    case "openai-compat":
      if (!cfg.baseUrl) throw new Error("openai-compat provider requires baseUrl");
      provider = new OpenAICompatProvider({
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        apiKey: cfg.apiKey,
        id: cfg.id,
      });
      break;
    default:
      throw new Error(`Provider kind not yet implemented: ${cfg.kind}`);
  }
  cache.set(key, provider);
  return provider;
}
