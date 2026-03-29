import { build } from "bun";

// Build main process (ESM) — bundle @slop/* since Electron can't resolve .ts imports
await build({
  entrypoints: ["src/main.ts"],
  outdir: "dist",
  target: "node",
  format: "esm",
  naming: "[name].mjs",
  external: ["electron"],
});

// Build preload script (CJS — required for Electron sandboxed renderer)
await build({
  entrypoints: ["src/preload.mts"],
  outdir: "dist",
  target: "node",
  format: "cjs",
  naming: "[name].cjs",
  external: ["electron"],
});

console.log("Build complete → dist/");
