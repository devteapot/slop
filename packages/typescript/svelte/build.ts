import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const packageDir = import.meta.dir;
const sourcePath = join(packageDir, "src", "index.svelte.ts");
const outputPath = join(packageDir, "dist", "index.svelte.ts");

mkdirSync(dirname(outputPath), { recursive: true });

// Preserve the Svelte rune source as the release artifact so downstream
// Svelte tooling can compile `.svelte.ts` correctly.
await Bun.write(outputPath, Bun.file(sourcePath));

console.log(`Staged ${outputPath}`);
