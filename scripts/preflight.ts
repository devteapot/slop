import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  getTypeScriptPackages,
  readJson,
  repoRoot,
  type PackageManifest,
} from "./release/shared";

type Check = {
  label: string;
  cwd: string;
  command: string;
  args: string[];
};

type Component = {
  id: string;
  label: string;
  roots: string[];
  excludedRoots?: string[];
  absoluteRoot: string;
  dependencies: string[];
  checks: Check[];
};

type RawPackageComponent = {
  id: string;
  label: string;
  manifest: PackageManifest;
  manifestPath: string;
  relativeDir: string;
  absoluteRoot: string;
  roots: string[];
  excludedRoots?: string[];
};

type Cause =
  | { kind: "changed"; files: string[] }
  | { kind: "dependency"; dependencyId: string };

type Args = {
  all: boolean;
  listOnly: boolean;
  since?: string;
  files: string[];
};

const SCAN_DIRS = ["apps", "examples", "website", "benchmarks"];
const WALK_IGNORE = new Set([
  ".git",
  "node_modules",
  "dist",
  "target",
  ".venv",
  "__pycache__",
  ".turbo",
  ".next",
  ".tanstack",
  ".angular",
]);

function parseArgs(argv: string[]): Args {
  const args: Args = {
    all: false,
    listOnly: false,
    files: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--all") {
      args.all = true;
    } else if (arg === "--list") {
      args.listOnly = true;
    } else if (arg === "--since") {
      args.since = argv[i + 1];
      i += 1;
    } else if (arg === "--files") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        args.files.push(normalizeRepoPath(argv[i + 1]));
        i += 1;
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function normalizeRepoPath(filePath: string): string {
  const absolute = resolve(repoRoot, filePath);
  return relative(repoRoot, absolute).replace(/\\/g, "/");
}

function runGit(args: string[]): string[] {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `git ${args.join(" ")} failed`);
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeRepoPath(line));
}

function detectChangedFiles(args: Args): string[] {
  if (args.all) {
    return [];
  }

  if (args.files.length > 0) {
    return [...new Set(args.files)];
  }

  if (args.since) {
    return runGit(["diff", "--name-only", `${args.since}...HEAD`]);
  }

  const tracked = runGit(["diff", "--name-only", "HEAD"]);
  const untracked = runGit(["ls-files", "--others", "--exclude-standard"]);
  return [...new Set([...tracked, ...untracked])];
}

function walkFiles(rootRelativeDir: string, filename: string): string[] {
  const root = join(repoRoot, rootRelativeDir);
  if (!existsSync(root)) {
    return [];
  }

  const results: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const currentStat = statSync(current);
    if (!currentStat.isDirectory()) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (WALK_IGNORE.has(entry.name)) {
        continue;
      }

      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name === filename) {
        results.push(fullPath);
      }
    }
  }

  return results.sort();
}

function hasTests(dir: string): boolean {
  const testsDir = join(dir, "__tests__");
  if (!existsSync(testsDir)) {
    return false;
  }

  return readdirSync(testsDir).some((name) => /\.test\./.test(name));
}

function createBunScriptCheck(relativeDir: string, scriptName: string): Check {
  return {
    label: `${relativeDir}: bun run ${scriptName}`,
    cwd: join(repoRoot, relativeDir),
    command: "bun",
    args: ["run", scriptName],
  };
}

function createCargoCheck(relativeDir: string, subcommand: "build" | "test"): Check {
  return {
    label: `${relativeDir}: cargo ${subcommand}`,
    cwd: join(repoRoot, relativeDir),
    command: "cargo",
    args: [subcommand],
  };
}

function createGoCheck(relativeDir: string): Check {
  return {
    label: `${relativeDir}: go test ./...`,
    cwd: join(repoRoot, relativeDir),
    command: "go",
    args: ["test", "./..."],
  };
}

function createPythonCheck(relativeDir: string, args: string[], label: string): Check {
  return {
    label: `${relativeDir}: ${label}`,
    cwd: join(repoRoot, relativeDir),
    command: "python3",
    args,
  };
}

function buildPackageChecks(relativeDir: string, manifest: PackageManifest): Check[] {
  const scripts = manifest.scripts ?? {};

  if (relativeDir === "apps/desktop") {
    return ["typecheck", "vite:build"]
      .filter((scriptName) => scripts[scriptName])
      .map((scriptName) => createBunScriptCheck(relativeDir, scriptName));
  }

  if (relativeDir === "website/docs") {
    return ["check:content", "build"]
      .filter((scriptName) => scripts[scriptName])
      .map((scriptName) => createBunScriptCheck(relativeDir, scriptName));
  }

  const checks = ["typecheck", "test", "build"]
    .filter((scriptName) => scripts[scriptName])
    .map((scriptName) => createBunScriptCheck(relativeDir, scriptName));

  if (relativeDir.startsWith("packages/typescript/") && hasTests(join(repoRoot, relativeDir))) {
    checks.push({
      label: `${relativeDir}: bun test`,
      cwd: join(repoRoot, relativeDir),
      command: "bun",
      args: ["test"],
    });
  }

  return checks;
}

function collectPackageComponents(): Component[] {
  const rawComponents: RawPackageComponent[] = [];

  for (const pkg of getTypeScriptPackages()) {
    rawComponents.push({
      id: `pkg:${pkg.relativeDir}`,
      label: pkg.manifest.name,
      manifest: pkg.manifest,
      manifestPath: pkg.manifestPath,
      relativeDir: pkg.relativeDir,
      absoluteRoot: pkg.dir,
      roots: [pkg.relativeDir],
    });
  }

  for (const scanDir of SCAN_DIRS) {
    for (const manifestPath of walkFiles(scanDir, "package.json")) {
      const relativePath = relative(repoRoot, manifestPath).replace(/\\/g, "/");
      if (relativePath.startsWith("packages/typescript/")) {
        continue;
      }

      const manifest = readJson<PackageManifest>(manifestPath);
      const absoluteRoot = dirname(manifestPath);
      const relativeDir = relative(repoRoot, absoluteRoot).replace(/\\/g, "/");
      rawComponents.push({
        id: `pkg:${relativeDir}`,
        label: manifest.name ?? relativeDir,
        manifest,
        manifestPath,
        relativeDir,
        absoluteRoot,
        roots:
          relativeDir === "website/docs"
            ? [relativeDir, "docs", "spec"]
            : [relativeDir],
        excludedRoots: relativeDir === "apps/desktop" ? ["apps/desktop/src-tauri"] : undefined,
      });
    }
  }

  const nameToId = new Map<string, string>();
  for (const component of rawComponents) {
    if (component.manifest.name) {
      nameToId.set(component.manifest.name, component.id);
    }
  }

  return rawComponents.map((component) => {
    const dependencies = new Set<string>();
    for (const sectionName of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ] as const) {
      const section = component.manifest[sectionName];
      if (!section) {
        continue;
      }

      for (const depName of Object.keys(section)) {
        const dependencyId = nameToId.get(depName);
        if (dependencyId) {
          dependencies.add(dependencyId);
        }
      }
    }

    return {
      id: component.id,
      label: component.label,
      roots: component.roots,
      excludedRoots: component.excludedRoots,
      absoluteRoot: component.absoluteRoot,
      dependencies: [...dependencies].sort(),
      checks: buildPackageChecks(component.relativeDir, component.manifest),
    };
  });
}

function parseCargoPathDependencies(filePath: string): string[] {
  const text = readFileSync(filePath, "utf8");
  const deps: string[] = [];
  const regex = /^\s*[\w-]+\s*=\s*\{[^}]*\bpath\s*=\s*"([^"]+)"[^}]*\}/gm;
  for (const match of text.matchAll(regex)) {
    deps.push(match[1]);
  }
  return deps;
}

function parseGoReplacePaths(filePath: string): string[] {
  const text = readFileSync(filePath, "utf8");
  const deps: string[] = [];
  const regex = /^\s*replace\s+\S+\s+=>\s+([^\s]+)\s*$/gm;
  for (const match of text.matchAll(regex)) {
    deps.push(match[1]);
  }
  return deps;
}

function parseUvSourcePaths(filePath: string): string[] {
  const text = readFileSync(filePath, "utf8");
  const deps: string[] = [];
  const uvSection = text.match(/\[tool\.uv\.sources\]([\s\S]*)/m)?.[1];
  if (!uvSection) {
    return deps;
  }

  const regex = /^\s*[\w-]+\s*=\s*\{[^}]*\bpath\s*=\s*"([^"]+)"[^}]*\}\s*$/gm;
  for (const match of uvSection.matchAll(regex)) {
    deps.push(match[1]);
  }
  return deps;
}

function resolveDependencyIds(
  baseDir: string,
  rawPaths: string[],
  componentByRoot: Map<string, string>,
): string[] {
  const dependencies = new Set<string>();
  for (const rawPath of rawPaths) {
    const absolute = resolve(baseDir, rawPath);
    const dependencyId = componentByRoot.get(absolute);
    if (dependencyId) {
      dependencies.add(dependencyId);
    }
  }
  return [...dependencies].sort();
}

function collectCargoComponents(): Component[] {
  const manifestPaths = [
    ...walkFiles("packages", "Cargo.toml"),
    ...walkFiles("apps", "Cargo.toml"),
    ...walkFiles("examples", "Cargo.toml"),
  ];

  const raw = manifestPaths.map((manifestPath) => {
    const absoluteRoot = dirname(manifestPath);
    const relativeDir = relative(repoRoot, absoluteRoot).replace(/\\/g, "/");
    return {
      id: `cargo:${relativeDir}`,
      label: relativeDir,
      manifestPath,
      absoluteRoot,
      relativeDir,
      roots: [relativeDir],
    };
  });

  const componentByRoot = new Map(raw.map((component) => [component.absoluteRoot, component.id]));

  return raw.map((component) => ({
    id: component.id,
    label: component.label,
    roots: component.roots,
    absoluteRoot: component.absoluteRoot,
    dependencies: resolveDependencyIds(
      component.absoluteRoot,
      parseCargoPathDependencies(component.manifestPath),
      componentByRoot,
    ),
    checks: [
      component.relativeDir.startsWith("packages/rust/")
        ? createCargoCheck(component.relativeDir, "test")
        : createCargoCheck(component.relativeDir, "build"),
    ],
  }));
}

function collectGoComponents(): Component[] {
  const manifestPaths = [
    ...walkFiles("packages", "go.mod"),
    ...walkFiles("apps", "go.mod"),
    ...walkFiles("examples", "go.mod"),
  ];

  const raw = manifestPaths.map((manifestPath) => {
    const absoluteRoot = dirname(manifestPath);
    const relativeDir = relative(repoRoot, absoluteRoot).replace(/\\/g, "/");
    return {
      id: `go:${relativeDir}`,
      label: relativeDir,
      manifestPath,
      absoluteRoot,
      relativeDir,
      roots: [relativeDir],
    };
  });

  const componentByRoot = new Map(raw.map((component) => [component.absoluteRoot, component.id]));

  return raw.map((component) => ({
    id: component.id,
    label: component.label,
    roots: component.roots,
    absoluteRoot: component.absoluteRoot,
    dependencies: resolveDependencyIds(
      component.absoluteRoot,
      parseGoReplacePaths(component.manifestPath),
      componentByRoot,
    ),
    checks: [createGoCheck(component.relativeDir)],
  }));
}

function collectPythonComponents(): Component[] {
  const manifestPaths = [
    ...walkFiles("packages", "pyproject.toml"),
    ...walkFiles("apps", "pyproject.toml"),
    ...walkFiles("examples", "pyproject.toml"),
  ];

  const raw = manifestPaths.map((manifestPath) => {
    const absoluteRoot = dirname(manifestPath);
    const relativeDir = relative(repoRoot, absoluteRoot).replace(/\\/g, "/");
    return {
      id: `py:${relativeDir}`,
      label: relativeDir,
      manifestPath,
      absoluteRoot,
      relativeDir,
      roots: [relativeDir],
    };
  });

  const componentByRoot = new Map(raw.map((component) => [component.absoluteRoot, component.id]));

  return raw.map((component) => {
    const testsDir = join(component.absoluteRoot, "tests");
    const srcDir = join(component.absoluteRoot, "src");
    const checks: Check[] = [];

    if (existsSync(testsDir)) {
      checks.push(createPythonCheck(component.relativeDir, ["-m", "pytest", "tests"], "python3 -m pytest tests"));
    } else if (existsSync(srcDir)) {
      checks.push(createPythonCheck(component.relativeDir, ["-m", "compileall", "src"], "python3 -m compileall src"));
    }

    return {
      id: component.id,
      label: component.label,
      roots: component.roots,
      absoluteRoot: component.absoluteRoot,
      dependencies: resolveDependencyIds(
        component.absoluteRoot,
        parseUvSourcePaths(component.manifestPath),
        componentByRoot,
      ),
      checks,
    };
  });
}

function buildComponents(): Component[] {
  return [
    ...collectPackageComponents(),
    ...collectCargoComponents(),
    ...collectGoComponents(),
    ...collectPythonComponents(),
  ];
}

function fileMatchesRoot(filePath: string, root: string): boolean {
  return filePath === root || filePath.startsWith(`${root}/`);
}

function fileMatchesComponent(filePath: string, component: Component): boolean {
  const included = component.roots.some((root) => fileMatchesRoot(filePath, root));
  if (!included) {
    return false;
  }

  return !(component.excludedRoots ?? []).some((root) => fileMatchesRoot(filePath, root));
}

function isRepoWideTrigger(filePath: string): boolean {
  return (
    filePath === "package.json" ||
    filePath === "bun.lock" ||
    filePath.startsWith("scripts/")
  );
}

function topologicalSort(components: Component[], affectedIds: Set<string>): Component[] {
  const componentMap = new Map(components.map((component) => [component.id, component]));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const id of affectedIds) {
    inDegree.set(id, 0);
  }

  for (const component of components) {
    if (!affectedIds.has(component.id)) {
      continue;
    }

    for (const dependencyId of component.dependencies) {
      if (!affectedIds.has(dependencyId)) {
        continue;
      }

      inDegree.set(component.id, (inDegree.get(component.id) ?? 0) + 1);
      dependents.set(dependencyId, [...(dependents.get(dependencyId) ?? []), component.id]);
    }
  }

  const queue = [...affectedIds]
    .filter((id) => (inDegree.get(id) ?? 0) === 0)
    .sort((a, b) => a.localeCompare(b));
  const ordered: Component[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    ordered.push(componentMap.get(id)!);

    for (const dependentId of (dependents.get(id) ?? []).sort()) {
      const nextDegree = (inDegree.get(dependentId) ?? 0) - 1;
      inDegree.set(dependentId, nextDegree);
      if (nextDegree === 0) {
        queue.push(dependentId);
        queue.sort((a, b) => a.localeCompare(b));
      }
    }
  }

  if (ordered.length !== affectedIds.size) {
    throw new Error("Unable to sort affected components; dependency cycle detected.");
  }

  return ordered;
}

function computeAffected(
  components: Component[],
  changedFiles: string[],
  runAll: boolean,
): {
  ordered: Component[];
  causes: Map<string, Cause>;
  repoWide: boolean;
} {
  const causes = new Map<string, Cause>();
  const componentMap = new Map(components.map((component) => [component.id, component]));
  const reverseDeps = new Map<string, string[]>();

  for (const component of components) {
    for (const dependencyId of component.dependencies) {
      reverseDeps.set(dependencyId, [...(reverseDeps.get(dependencyId) ?? []), component.id]);
    }
  }

  const affected = new Set<string>();
  const queue: string[] = [];
  const repoWide = runAll || changedFiles.some(isRepoWideTrigger);

  if (repoWide) {
    for (const component of components) {
      affected.add(component.id);
      causes.set(component.id, { kind: "changed", files: ["repo-wide trigger"] });
    }
  } else {
    for (const component of components) {
      const matchedFiles = changedFiles.filter((filePath) =>
        fileMatchesComponent(filePath, component),
      );

      if (matchedFiles.length === 0) {
        continue;
      }

      affected.add(component.id);
      causes.set(component.id, { kind: "changed", files: matchedFiles });
      queue.push(component.id);
    }

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      for (const dependentId of reverseDeps.get(currentId) ?? []) {
        if (affected.has(dependentId)) {
          continue;
        }

        affected.add(dependentId);
        causes.set(dependentId, { kind: "dependency", dependencyId: currentId });
        queue.push(dependentId);
      }
    }
  }

  return {
    ordered: topologicalSort(components, affected),
    causes,
    repoWide,
  };
}

function printPlan(ordered: Component[], causes: Map<string, Cause>, repoWide: boolean): void {
  if (ordered.length === 0) {
    console.log("No affected components.");
    return;
  }

  if (repoWide) {
    console.log("Repo-wide trigger detected, running all automated preflight checks.\n");
  }

  console.log("Affected components:\n");
  for (const component of ordered) {
    const cause = causes.get(component.id);
    console.log(`- ${component.label}`);
    if (cause?.kind === "changed") {
      console.log(`  reason: changed ${cause.files.join(", ")}`);
    } else if (cause?.kind === "dependency") {
      console.log(`  reason: depends on ${ordered.find((item) => item.id === cause.dependencyId)?.label ?? cause.dependencyId}`);
    }

    if (component.checks.length === 0) {
      console.log("  checks: none configured");
    } else {
      for (const check of component.checks) {
        console.log(`  check: ${check.label}`);
      }
    }
  }
}

function runChecks(ordered: Component[]): void {
  const checks = ordered.flatMap((component) => component.checks);

  if (checks.length === 0) {
    console.log("No automated checks to run.");
    return;
  }

  console.log(`Running ${checks.length} check(s)...\n`);
  for (const check of checks) {
    console.log(`==> ${check.label}`);
    const result = spawnSync(check.command, check.args, {
      cwd: check.cwd,
      stdio: "inherit",
      env: process.env,
    });

    if (result.status !== 0) {
      throw new Error(`Check failed: ${check.label}`);
    }
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const changedFiles = detectChangedFiles(args);
  const components = buildComponents();
  const { ordered, causes, repoWide } = computeAffected(components, changedFiles, args.all);

  printPlan(ordered, causes, repoWide);

  if (!args.listOnly) {
    console.log("");
    runChecks(ordered);
  }
}

main();
