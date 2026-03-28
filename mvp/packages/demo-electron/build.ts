import { build } from "bun";

// Build main process (ESM)
await build({
  entrypoints: ["src/main.ts"],
  outdir: "dist",
  target: "node",
  format: "esm",
  naming: "[name].mjs",
  external: ["electron", "ws"],
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
