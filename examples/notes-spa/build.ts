import { join } from "path";

const dir = import.meta.dir;

const result = await Bun.build({
  entrypoints: [join(dir, "src/main.tsx")],
  outdir: join(dir, "dist"),
  naming: "app.js",
  target: "browser",
  minify: false,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log("Built dist/app.js");
