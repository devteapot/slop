import { readFileSync, writeFileSync, cpSync, mkdirSync } from "fs";
import { join } from "path";

const dir = import.meta.dir;
const dist = join(dir, "dist");

mkdirSync(dist, { recursive: true });

// Bundle each entry point
const entryPoints = [
  { entry: "src/background/index.ts", out: "dist/background.js" },
  { entry: "src/content/index.ts", out: "dist/content.js" },
  { entry: "src/options/options.ts", out: "dist/options.js" },
  { entry: "src/popup/popup.ts", out: "dist/popup.js" },
];

for (const { entry, out } of entryPoints) {
  const result = await Bun.build({
    entrypoints: [join(dir, entry)],
    outdir: dist,
    naming: out.replace("dist/", ""),
    target: "browser",
    format: "iife",
    minify: false,
  });
  if (!result.success) {
    console.error(`Failed to build ${entry}:`);
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}

// Copy static files
cpSync(join(dir, "src/options/options.html"), join(dist, "../options.html"));
cpSync(join(dir, "src/ui/chat.css"), join(dist, "chat.css"));
cpSync(join(dir, "manifest.json"), join(dist, "../manifest.json"), { force: true });

// Copy icons if they exist
try {
  cpSync(join(dir, "icons"), join(dist, "../icons"), { recursive: true });
} catch {}

console.log("Extension built to dist/");
