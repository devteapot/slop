/**
 * Tiny bun server for the benchmarks dashboard. Serves the static dashboard
 * files from this directory and exposes /results/<sweep>/runs.jsonl plus a
 * /sweeps endpoint that lists every sweep id with a runs.jsonl on disk.
 *
 * Run with: `bun run dashboard/serve.ts` (or `bun run dash` from v2/).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const DASH_DIR = new URL(".", import.meta.url).pathname;
const V2_ROOT = resolve(DASH_DIR, "..");
const RESULTS_DIR = join(V2_ROOT, "results");
const PORT = Number(process.env.DASH_PORT ?? 4180);

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  jsonl: "application/x-ndjson; charset=utf-8",
};

function contentType(path: string): string {
  const ext = path.split(".").pop() ?? "";
  return MIME[ext] ?? "text/plain; charset=utf-8";
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname);

    if (path === "/sweeps") {
      if (!existsSync(RESULTS_DIR)) return Response.json([]);
      const sweeps: string[] = [];
      for (const entry of readdirSync(RESULTS_DIR)) {
        const runsPath = join(RESULTS_DIR, entry, "runs.jsonl");
        if (existsSync(runsPath)) sweeps.push(entry);
      }
      sweeps.sort((a, b) => {
        const ma = statSync(join(RESULTS_DIR, a, "runs.jsonl")).mtimeMs;
        const mb = statSync(join(RESULTS_DIR, b, "runs.jsonl")).mtimeMs;
        return ma - mb;
      });
      return Response.json(sweeps);
    }

    if (path.startsWith("/results/")) {
      const rel = path.slice("/results/".length);
      const file = resolve(RESULTS_DIR, rel);
      if (!file.startsWith(RESULTS_DIR)) return new Response("forbidden", { status: 403 });
      if (!existsSync(file) || !statSync(file).isFile()) return new Response("not found", { status: 404 });
      return new Response(readFileSync(file), { headers: { "Content-Type": contentType(file) } });
    }

    // Dashboard static files
    const localPath = path === "/" ? "/index.html" : path;
    const file = resolve(DASH_DIR, `.${localPath}`);
    if (!file.startsWith(DASH_DIR)) return new Response("forbidden", { status: 403 });
    if (existsSync(file) && statSync(file).isFile()) {
      return new Response(readFileSync(file), { headers: { "Content-Type": contentType(file) } });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`[dashboard] http://localhost:${PORT}`);
console.log(`[dashboard] serving dashboard from ${DASH_DIR}`);
console.log(`[dashboard] serving results from  ${RESULTS_DIR}`);
