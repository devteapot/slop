// SLOP benchmarks v2 — dashboard client. Aggregates runs.jsonl in the browser
// so the user can pivot on any two axes without regenerating data. Mirrors
// the math in benchmarks/v2/metrics/stats.ts (kept deliberately tiny).

const AXES = [
  { id: "app", label: "app", pick: (c) => c.cell.app },
  { id: "scale", label: "scale", pick: (c) => c.cell.scale },
  { id: "scenario", label: "scenario", pick: (c) => c.cell.scenario },
  { id: "variant", label: "variant", pick: (c) => variantLabel(c.cell) },
  { id: "model", label: "model", pick: (c) => `${c.cell.provider.kind}:${c.cell.provider.model}` },
  { id: "protocol", label: "protocol", pick: (c) => c.cell.protocol },
  { id: "optimization", label: "optimization", pick: (c) => c.cell.optimization },
];

const METRICS = [
  { id: "passRate", label: "pass rate", format: (v) => `${(v * 100).toFixed(0)}%`, pick: (a) => a.passRate },
  { id: "totalTokens", label: "tokens (mean)", format: fmtInt, pick: (a) => a.totalTokens.mean },
  { id: "tokensPerSuccess", label: "tokens per success", format: fmtInt, pick: (a) => a.tokensPerSuccess },
  { id: "maxContextTokens", label: "max context tokens", format: fmtInt, pick: (a) => a.maxContextTokens.mean },
  { id: "turns", label: "turns (mean)", format: (v) => v.toFixed(1), pick: (a) => a.turns.mean },
  { id: "toolCalls", label: "tool calls (mean)", format: (v) => v.toFixed(1), pick: (a) => a.toolCalls.mean },
  { id: "specComplianceRate", label: "spec compliance", format: (v) => `${(v * 100).toFixed(0)}%`, pick: (a) => a.specComplianceRate.mean },
  { id: "totalTimeS", label: "wall time (s)", format: (v) => v.toFixed(1), pick: (a) => a.totalTimeMs.mean / 1000 },
  { id: "llmTimeS", label: "llm time (s)", format: (v) => v.toFixed(1), pick: (a) => a.llmTimeMs.mean / 1000 },
  { id: "costPerSuccess", label: "$ per success", format: fmtCost, pick: (a) => a.costPerSuccess },
];

const state = {
  runs: [],
  cellAggregates: [],
  rowAxis: "variant",
  colAxis: "scenario",
  metric: "totalTokens",
  filters: { app: "", scenario: "", scale: "" },
};

init();

async function init() {
  populateSelect("rowAxis", AXES.map((a) => ({ value: a.id, label: a.label })));
  populateSelect("colAxis", AXES.map((a) => ({ value: a.id, label: a.label })));
  populateSelect("metric", METRICS.map((m) => ({ value: m.id, label: m.label })));
  document.getElementById("rowAxis").value = state.rowAxis;
  document.getElementById("colAxis").value = state.colAxis;
  document.getElementById("metric").value = state.metric;

  document.getElementById("rowAxis").addEventListener("change", (e) => {
    state.rowAxis = e.target.value;
    render();
  });
  document.getElementById("colAxis").addEventListener("change", (e) => {
    state.colAxis = e.target.value;
    render();
  });
  document.getElementById("metric").addEventListener("change", (e) => {
    state.metric = e.target.value;
    render();
  });
  for (const key of ["filterApp", "filterScenario", "filterScale"]) {
    document.getElementById(key).addEventListener("change", (e) => {
      const filterKey = key.replace("filter", "").toLowerCase();
      state.filters[filterKey] = e.target.value;
      render();
    });
  }
  document.getElementById("fileInput").addEventListener("change", onFileSelected);
  document.getElementById("sweep").addEventListener("change", (e) => {
    if (e.target.value) loadSweepByName(e.target.value);
  });

  // Try to auto-discover sweeps (when served from bun)
  try {
    const res = await fetch("/sweeps");
    if (res.ok) {
      const list = await res.json();
      const sel = document.getElementById("sweep");
      sel.innerHTML = '<option value="">—</option>';
      for (const name of list) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
      }
      const qsSweep = new URL(location.href).searchParams.get("sweep");
      if (qsSweep && list.includes(qsSweep)) {
        sel.value = qsSweep;
        loadSweepByName(qsSweep);
      } else if (list.length > 0) {
        sel.value = list[list.length - 1];
        loadSweepByName(sel.value);
      }
    }
  } catch {
    // Not served from the bun dashboard server — user must pick a file manually.
  }
}

async function loadSweepByName(name) {
  setStatus(`loading ${name}…`);
  try {
    const res = await fetch(`/results/${name}/runs.jsonl`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    loadRunsText(text, name);
  } catch (err) {
    setStatus(`failed to load: ${err.message}`);
  }
}

function onFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => loadRunsText(String(reader.result), file.name);
  reader.readAsText(file);
}

function loadRunsText(text, source) {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const runs = [];
  let sweepConfig = null;
  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type === "sweep") sweepConfig = obj.config;
    else if (obj.cellId) runs.push(obj);
  }
  state.runs = runs;
  state.cellAggregates = aggregateCells(runs);
  setStatus(`loaded ${source}: ${runs.length} runs, ${state.cellAggregates.length} cells`);

  // Populate filter selects from data
  populateFilter("filterApp", runs.map((r) => r.cell.app));
  populateFilter("filterScenario", runs.map((r) => r.cell.scenario));
  populateFilter("filterScale", runs.map((r) => r.cell.scale));
  render();
}

function render() {
  const host = document.getElementById("table-host");
  const cells = filterCells(state.cellAggregates, state.filters);
  if (cells.length === 0) {
    host.innerHTML = '<div class="empty-message">no cells match the current filters</div>';
    return;
  }
  const rowAxis = AXES.find((a) => a.id === state.rowAxis);
  const colAxis = AXES.find((a) => a.id === state.colAxis);
  const metric = METRICS.find((m) => m.id === state.metric);

  const rowValues = unique(cells.map((c) => rowAxis.pick(c)));
  const colValues = unique(cells.map((c) => colAxis.pick(c)));

  const grid = new Map();
  for (const c of cells) {
    const key = `${rowAxis.pick(c)}__${colAxis.pick(c)}`;
    const list = grid.get(key) ?? [];
    list.push(c);
    grid.set(key, list);
  }

  let html = "<table><thead><tr><th class='row-header'></th>";
  for (const col of colValues) html += `<th>${escapeHtml(col)}</th>`;
  html += "</tr></thead><tbody>";
  for (const row of rowValues) {
    html += `<tr><td class='row-header'>${escapeHtml(row)}</td>`;
    for (const col of colValues) {
      const list = grid.get(`${row}__${col}`) ?? [];
      if (list.length === 0) {
        html += "<td class='empty'>—</td>";
      } else {
        const mergedPass = mergePassRate(list);
        const val = mergeMetric(list, metric);
        const cellId = list.map((c) => c.cellId).join(",");
        const sample = list.reduce((a, c) => a + c.runs, 0);
        const passClass = mergedPass === 1 ? "" : mergedPass >= 0.5 ? "warn" : "bad";
        html += `<td class='cell' data-key='${escapeHtml(row)}__${escapeHtml(col)}' data-cells='${cellId}'>` +
          `<div class='primary'>${escapeHtml(metric.format(val))}</div>` +
          `<div class='secondary'>n=${sample}${list[0].runs > 1 ? ` ± ${fmtInt(stdevOf(list, metric))}` : ""}</div>` +
          `<div class='passbar ${passClass}'><span style='width:${(mergedPass * 100).toFixed(0)}%'></span></div>` +
          "</td>";
      }
    }
    html += "</tr>";
  }
  html += "</tbody></table>";
  host.innerHTML = html;

  host.querySelectorAll("td.cell").forEach((td) => {
    td.addEventListener("click", () => openCellDetail(td.dataset.cells));
  });
}

function mergePassRate(aggs) {
  const totalRuns = aggs.reduce((a, c) => a + c.runs, 0);
  if (totalRuns === 0) return 0;
  const totalPass = aggs.reduce((a, c) => a + c.passRate * c.runs, 0);
  return totalPass / totalRuns;
}

function mergeMetric(aggs, metric) {
  // Weighted mean across all aggregates matching the pivot cell.
  const totalRuns = aggs.reduce((a, c) => a + c.runs, 0);
  if (totalRuns === 0) return 0;
  let sum = 0;
  for (const c of aggs) {
    const v = metric.pick(c);
    if (!isFinite(v)) continue;
    sum += v * c.runs;
  }
  return sum / totalRuns;
}

function stdevOf(aggs, metric) {
  // Pooled approximate stdev — good enough for a dashboard hover.
  let n = 0;
  let ssq = 0;
  let mean = 0;
  for (const c of aggs) {
    const nv = c.runs;
    const mv = metric.pick(c);
    if (!isFinite(mv)) continue;
    const delta = mv - mean;
    n += nv;
    mean += (delta * nv) / n;
    ssq += nv * delta * (mv - mean);
  }
  if (n < 2) return 0;
  return Math.sqrt(ssq / (n - 1));
}

function openCellDetail(cellIds) {
  const ids = cellIds.split(",");
  const aggs = state.cellAggregates.filter((c) => ids.includes(c.cellId));
  if (aggs.length === 0) return;
  const runs = state.runs.filter((r) => ids.includes(r.cellId));
  const title = `${aggs.map((a) => variantLabel(a.cell)).join(" / ")}`;
  document.getElementById("modal-title").textContent = title;
  const body = document.getElementById("modal-body");

  let html = "";
  for (const a of aggs) {
    const cats = a.failureCategories;
    const total = Object.values(cats).reduce((s, v) => s + v, 0);
    html += `<h3 style='font-size:12px; color: var(--accent); margin:12px 0 6px'>${escapeHtml(variantLabel(a.cell))} × ${escapeHtml(a.cell.scenario)}</h3>`;
    html += "<dl class='kv'>";
    html += `<dt>cellId</dt><dd>${escapeHtml(a.cellId)}</dd>`;
    html += `<dt>runs</dt><dd>${a.runs}</dd>`;
    html += `<dt>pass rate</dt><dd>${(a.passRate * 100).toFixed(0)}%</dd>`;
    html += `<dt>spec compliance</dt><dd>${(a.specComplianceRate.mean * 100).toFixed(0)}%</dd>`;
    html += `<dt>tokens</dt><dd>${fmtInt(a.totalTokens.mean)} (p95 ${fmtInt(a.totalTokens.p95)}, σ ${fmtInt(a.totalTokens.stdev)})</dd>`;
    html += `<dt>max context</dt><dd>${fmtInt(a.maxContextTokens.mean)}</dd>`;
    html += `<dt>turns</dt><dd>${a.turns.mean.toFixed(1)}</dd>`;
    html += `<dt>tool calls</dt><dd>${a.toolCalls.mean.toFixed(1)}</dd>`;
    html += `<dt>wall time</dt><dd>${(a.totalTimeMs.mean / 1000).toFixed(1)}s</dd>`;
    html += `<dt>llm time</dt><dd>${(a.llmTimeMs.mean / 1000).toFixed(1)}s</dd>`;
    html += `<dt>$ per success</dt><dd>${fmtCost(a.costPerSuccess)}</dd>`;
    html += "</dl>";
    if (total > 0) {
      html += "<div class='category-bar'>";
      for (const [key, val] of Object.entries(cats)) {
        if (val === 0) continue;
        html += `<div class='cat-${key}' style='width:${(val / total * 100).toFixed(1)}%' title='${key}: ${val}'></div>`;
      }
      html += "</div>";
      html += `<div class='secondary' style='font-size: 11px; color: var(--text-dim); margin-top: 4px'>${Object.entries(cats).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(" / ")}</div>`;
    }
  }

  // Per-run table
  html += "<h3 style='font-size:12px; color: var(--accent); margin: 16px 0 6px'>per-run detail</h3>";
  html += "<pre>";
  html += `${"iter".padEnd(5)}${"turns".padStart(7)}${"calls".padStart(7)}${"spec%".padStart(7)}${"tok".padStart(9)}${"ctxMx".padStart(8)}${"t(s)".padStart(8)} verify\n`;
  for (const r of runs) {
    const m = r.metrics;
    if (!m) {
      html += `${String(r.cell.iteration).padEnd(5)} ERROR: ${escapeHtml((r.error ?? "").split("\n")[0])}\n`;
      continue;
    }
    const v = m.verification ? `${m.verification.passedChecks}/${m.verification.totalChecks}` : "—";
    html += `${String(r.cell.iteration).padEnd(5)}${String(m.turns).padStart(7)}${String(m.toolCalls).padStart(7)}${`${(m.specComplianceRate * 100).toFixed(0)}%`.padStart(7)}${fmtInt(m.totalTokens).padStart(9)}${fmtInt(m.maxContextTokens).padStart(8)}${(m.totalTimeMs / 1000).toFixed(1).padStart(8)} ${v}\n`;
  }
  html += "</pre>";

  body.innerHTML = html;
  document.getElementById("modal").showModal();
}

function aggregateCells(runs) {
  const buckets = new Map();
  for (const r of runs) {
    const list = buckets.get(r.cellId) ?? [];
    list.push(r);
    buckets.set(r.cellId, list);
  }
  const out = [];
  for (const [cellId, bucket] of buckets) {
    const metrics = bucket.map((r) => r.metrics).filter((m) => m);
    if (metrics.length === 0) continue;
    const first = bucket[0];
    const passCount = bucket.filter((r) => r.metrics?.verification?.passed === true).length;
    const passRate = passCount / bucket.length;
    const agg = (pick) => numericAgg(metrics.map(pick));
    const pricing = { "gemma4:31b": [0, 0], "gemma4:e4b-it": [0, 0], "nemotron-3-super:120b": [0, 0] };
    const price = pricing[first.cell.provider.model] ?? [0, 0];
    const costMean = metrics.reduce((s, m) => s + (m.inputTokens * price[0] + m.outputTokens * price[1]) / 1_000_000, 0) / metrics.length;
    const costAgg = { count: metrics.length, mean: costMean, median: costMean, p95: costMean, stdev: 0, min: costMean, max: costMean };
    out.push({
      cellId,
      cell: first.cell,
      runs: bucket.length,
      passRate,
      failureCategories: countCategories(bucket),
      totalTokens: agg((m) => m.totalTokens),
      inputTokens: agg((m) => m.inputTokens),
      outputTokens: agg((m) => m.outputTokens),
      maxContextTokens: agg((m) => m.maxContextTokens),
      turns: agg((m) => m.turns),
      toolCalls: agg((m) => m.toolCalls),
      specComplianceRate: agg((m) => m.specComplianceRate),
      llmTimeMs: agg((m) => m.llmTimeMs),
      totalTimeMs: agg((m) => m.totalTimeMs),
      transportBytes: agg((m) => m.transportBytesSent + m.transportBytesReceived),
      costUsd: costAgg,
      costPerSuccess: passCount > 0 ? (costMean * bucket.length) / passCount : Infinity,
      tokensPerSuccess: passCount > 0 ? (agg((m) => m.totalTokens).mean * bucket.length) / passCount : Infinity,
    });
  }
  return out;
}

function countCategories(runs) {
  const counts = { ok: 0, no_verifier: 0, verify_fail: 0, max_turns: 0, tool_unknown: 0, tool_invoke_error: 0, tool_param_error: 0, cell_exception: 0 };
  for (const r of runs) {
    if (r.error) { counts.cell_exception += 1; continue; }
    const m = r.metrics;
    if (!m) continue;
    if (m.unknownToolCalls > 0) counts.tool_unknown += 1;
    if (m.invokeErrorCalls > 0) counts.tool_invoke_error += 1;
    if (m.paramErrorCalls > 0) counts.tool_param_error += 1;
    if (m.finishReason === "max_turns") counts.max_turns += 1;
    if (!m.verification) { counts.no_verifier += 1; continue; }
    if (m.verification.passed) counts.ok += 1;
    else counts.verify_fail += 1;
  }
  return counts;
}

function numericAgg(values) {
  const vs = values.filter((v) => Number.isFinite(v));
  if (vs.length === 0) return { count: 0, mean: 0, median: 0, p95: 0, stdev: 0, min: 0, max: 0 };
  const sorted = [...vs].sort((a, b) => a - b);
  const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
  const median = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const stdev = vs.length > 1 ? Math.sqrt(vs.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (vs.length - 1)) : 0;
  return { count: vs.length, mean, median, p95, stdev, min: sorted[0], max: sorted[sorted.length - 1] };
}

function percentile(sorted, q) {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function variantLabel(cell) {
  if (cell.protocol === "mcp") return `mcp:${cell.mcpVariant ?? "flat"}`;
  return `slop:${cell.prompt}/${cell.encoding}/${cell.optimization}`;
}

function filterCells(cells, filters) {
  return cells.filter((c) => {
    if (filters.app && c.cell.app !== filters.app) return false;
    if (filters.scenario && c.cell.scenario !== filters.scenario) return false;
    if (filters.scale && c.cell.scale !== filters.scale) return false;
    return true;
  });
}

function unique(arr) {
  return Array.from(new Set(arr));
}

function populateSelect(id, items) {
  const sel = document.getElementById(id);
  sel.innerHTML = "";
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = item.value;
    opt.textContent = item.label;
    sel.appendChild(opt);
  }
}

function populateFilter(id, values) {
  const sel = document.getElementById(id);
  const current = sel.value;
  sel.innerHTML = '<option value="">all</option>';
  for (const v of unique(values)) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }
  if (unique(values).includes(current)) sel.value = current;
}

function fmtInt(v) {
  if (!Number.isFinite(v)) return "∞";
  return Math.round(v).toLocaleString();
}

function fmtCost(v) {
  if (!Number.isFinite(v)) return "∞";
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(3)}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}
