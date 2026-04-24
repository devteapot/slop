// Bundle src/app.ts into a single inlined HTML file under dist/iframe.html.
// That file is served verbatim as the `ui://` resource by the MCP server.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outDir = join(import.meta.dir, "..", "dist");
const entry = join(import.meta.dir, "..", "src", "app.ts");

const built = await Bun.build({
  entrypoints: [entry],
  target: "browser",
  format: "esm",
  minify: true,
});

if (!built.success) {
  console.error(built.logs);
  process.exit(1);
}

const jsArtifact = built.outputs.find((o) => o.kind === "entry-point");
if (!jsArtifact) throw new Error("bun build produced no entry-point output");
const js = await jsArtifact.text();

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>SLOP — Kanban</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; background: #0f172a; color: #f1f5f9; }
      h1 { font-size: 18px; margin: 0 0 12px; }
      .cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
      .col { background: #1e293b; border-radius: 8px; padding: 12px; }
      .col h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; margin: 0 0 8px; }
      .col ul { list-style: none; padding: 0; margin: 0; }
      .col li { background: #334155; padding: 8px 10px; border-radius: 6px; margin-bottom: 6px; font-size: 13px; }
      .col li.done { text-decoration: line-through; opacity: 0.6; }
    </style>
  </head>
  <body>
    <h1>Kanban — SLOP inside MCP Apps</h1>
    <div id="status" style="font-size: 11px; opacity: 0.6; margin-bottom: 8px;">booting…</div>
    <div id="board"></div>
    <script type="module">${js}</script>
  </body>
</html>
`;

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "iframe.html"), html, "utf8");
console.log(`wrote ${outDir}/iframe.html (${html.length} bytes)`);
