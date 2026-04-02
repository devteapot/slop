import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PackageManifest = {
  name: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: unknown;
};

export type WorkspacePackage = {
  dir: string;
  relativeDir: string;
  manifestPath: string;
  manifest: PackageManifest;
  internalDependencies: string[];
};

export const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const packageRoot = join(repoRoot, "packages", "typescript");

export function getStableReleaseVersion(input: string | undefined): string {
  const raw = input?.trim();
  if (!raw) {
    throw new Error("A release version is required. Pass vX.Y.Z or X.Y.Z.");
  }

  const version = raw.startsWith("v") ? raw.slice(1) : raw;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `Invalid release version "${raw}". Expected a stable SemVer tag like v1.2.3.`,
    );
  }

  return version;
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

export function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function replaceVersionInToml(
  fileContents: string,
  version: string,
  sectionHeader?: string,
): string {
  const pattern = sectionHeader
    ? new RegExp(`(\\[${escapeRegExp(sectionHeader)}\\][\\s\\S]*?^version = ")[^"]+(")`, "m")
    : /(^version = ")[^"]+(")/m;
  return fileContents.replace(pattern, `$1${version}$2`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getTypeScriptPackages(): WorkspacePackage[] {
  const packageDirs = readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packageRoot, entry.name))
    .sort();

  const manifests = packageDirs.map((dir) => {
    const manifestPath = join(dir, "package.json");
    const manifest = readJson<PackageManifest>(manifestPath);
    return {
      dir,
      relativeDir: relative(repoRoot, dir),
      manifestPath,
      manifest,
      internalDependencies: [] as string[],
    };
  });

  const workspaceNames = new Set(manifests.map((pkg) => pkg.manifest.name));

  for (const pkg of manifests) {
    const internalDependencies = new Set<string>();
    for (const sectionName of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ] as const) {
      const section = pkg.manifest[sectionName];
      if (!section) {
        continue;
      }

      for (const depName of Object.keys(section)) {
        if (workspaceNames.has(depName)) {
          internalDependencies.add(depName);
        }
      }
    }

    pkg.internalDependencies = [...internalDependencies];
  }

  return manifests;
}

export function sortPackagesForPublish(packages: WorkspacePackage[]): WorkspacePackage[] {
  const pending = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));
  const resolved = new Set<string>();
  const ordered: WorkspacePackage[] = [];

  while (pending.size > 0) {
    const ready = [...pending.values()].filter((pkg) =>
      pkg.internalDependencies.every((dep) => resolved.has(dep) || !pending.has(dep)),
    );

    if (ready.length === 0) {
      throw new Error(
        `Unable to resolve package publish order for: ${[...pending.keys()].join(", ")}`,
      );
    }

    ready.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));

    for (const pkg of ready) {
      pending.delete(pkg.manifest.name);
      resolved.add(pkg.manifest.name);
      ordered.push(pkg);
    }
  }

  return ordered;
}

export function updateInternalDependencyVersions(
  manifest: PackageManifest,
  version: string,
  workspaceNames: Set<string>,
): void {
  for (const sectionName of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ] as const) {
    const section = manifest[sectionName];
    if (!section) {
      continue;
    }

    for (const depName of Object.keys(section)) {
      if (workspaceNames.has(depName)) {
        section[depName] = `^${version}`;
      }
    }
  }
}

export function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(
      `Command failed (${result.status ?? "unknown"}): ${command} ${args.join(" ")}`,
    );
  }
}
