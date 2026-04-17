import type { DataScale } from "../../runner/types.ts";
import type { DirNode, FileNode } from "./store.ts";
import { joinPath } from "./store.ts";

/**
 * Deterministic file-tree seed. Shape grows both wider and deeper with
 * scale so the size-vs-depth axis is exercised.
 *
 * - s: depth 2, ~8 files
 * - m: depth 3, ~30 files
 * - l: depth 4, ~120 files
 * - xl: depth 5, ~500 files
 *
 * Guarantees (for scenario verifiers):
 * - Exactly one file named "README.md" somewhere in the tree
 * - At least one empty directory
 * - At least 3 files with ".log" extension
 */
const SHAPES: Record<DataScale, { depth: number; dirsPerLevel: number; filesPerDir: number }> = {
  s: { depth: 2, dirsPerLevel: 2, filesPerDir: 2 },
  m: { depth: 3, dirsPerLevel: 3, filesPerDir: 2 },
  l: { depth: 4, dirsPerLevel: 3, filesPerDir: 3 },
  xl: { depth: 5, dirsPerLevel: 3, filesPerDir: 4 },
};

const NAMES = ["src", "lib", "tests", "docs", "assets", "build", "dist", "config", "scripts", "examples"];
const FILE_NAMES = ["main.ts", "util.ts", "index.html", "styles.css", "data.json", "notes.md", "debug.log"];

function makeRng(seed: number) {
  let x = seed || 0x3cafeba;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 1_000_000) / 1_000_000;
  };
}

export function seedFileBrowser(scale: DataScale, seed: number): { dirs: DirNode[]; files: FileNode[] } {
  const rng = makeRng(seed);
  const shape = SHAPES[scale];
  const dirs = new Map<string, DirNode>();
  const files: FileNode[] = [];

  // Root
  const root: DirNode = { path: "/", name: "", dirs: [], files: [] };
  dirs.set("/", root);

  // README.md at the root — guarantees a discoverable file for find-and-read.
  const readme: FileNode = {
    path: "/README.md",
    name: "README.md",
    sizeBytes: 128,
    content: "SLOP benchmarks v2 — file-browser sample tree. Look for README at the root.",
  };
  files.push(readme);
  root.files.push(readme.path);

  buildLevel(root, 0, shape, rng, dirs, files);

  // Guarantee an empty dir at the root: one named "empty".
  const empty: DirNode = { path: "/empty", name: "empty", dirs: [], files: [] };
  dirs.set(empty.path, empty);
  root.dirs.push(empty.path);

  // Guarantee at least 3 .log files — seed them under the first child dir.
  const firstChild = dirs.get(root.dirs.find((p) => p !== "/empty") ?? "/empty");
  if (firstChild) {
    for (let i = 0; i < 3; i++) {
      const name = `run-${i + 1}.log`;
      const path = joinPath(firstChild.path, name);
      files.push({ path, name, sizeBytes: 512, content: `log output ${i + 1}` });
      firstChild.files.push(path);
    }
  }

  return { dirs: Array.from(dirs.values()), files };
}

function buildLevel(
  parent: DirNode,
  depth: number,
  shape: { depth: number; dirsPerLevel: number; filesPerDir: number },
  rng: () => number,
  dirs: Map<string, DirNode>,
  files: FileNode[],
) {
  if (depth >= shape.depth) return;
  const dirCount = Math.max(1, Math.round(shape.dirsPerLevel * (0.7 + rng() * 0.6)));
  for (let i = 0; i < dirCount; i++) {
    const name = `${NAMES[Math.floor(rng() * NAMES.length)]}-${i + 1}`;
    const path = joinPath(parent.path, name);
    const dir: DirNode = { path, name, dirs: [], files: [] };
    dirs.set(path, dir);
    parent.dirs.push(path);
    // Add files to this directory
    const fileCount = Math.max(1, Math.round(shape.filesPerDir * (0.6 + rng() * 0.8)));
    for (let j = 0; j < fileCount; j++) {
      const fileName = `${FILE_NAMES[Math.floor(rng() * FILE_NAMES.length)].replace(/\.(\w+)$/, `-${j + 1}.$1`)}`;
      const fpath = joinPath(path, fileName);
      files.push({ path: fpath, name: fileName, sizeBytes: 256 + Math.floor(rng() * 2048), content: `// file ${fpath}` });
      dir.files.push(fpath);
    }
    buildLevel(dir, depth + 1, shape, rng, dirs, files);
  }
}
