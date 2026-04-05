import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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
const packageBase = join(repoRoot, "packages", "typescript");
const packageGroups = ["sdk", "adapters", "integrations"];

export function getReleaseVersion(input: string | undefined): string {
  const raw = input?.trim();
  if (!raw) {
    throw new Error("A release version is required. Pass vX.Y.Z or X.Y.Z[-prerelease].");
  }

  const version = raw.startsWith("v") ? raw.slice(1) : raw;
  if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(version)) {
    throw new Error(
      `Invalid release version "${raw}". Expected a SemVer tag like v1.2.3 or v1.2.3-rc.1.`,
    );
  }

  return version;
}

/** @deprecated Use getReleaseVersion instead. */
export const getStableReleaseVersion = getReleaseVersion;

export function isPrerelease(version: string): boolean {
  return version.includes("-");
}

/**
 * Returns the npm dist-tag for a version.
 * Pre-release versions get "next", stable versions get "latest".
 */
export function getNpmTag(version: string): string {
  return isPrerelease(version) ? "next" : "latest";
}

/**
 * Convert semver pre-release to PEP 440.
 * e.g. "0.1.0-rc.1" → "0.1.0rc1", "0.1.0-alpha.2" → "0.1.0a2"
 * Stable versions pass through unchanged.
 */
export function toPep440(version: string): string {
  const match = version.match(/^(\d+\.\d+\.\d+)-(.+)$/);
  if (!match) return version;

  const base = match[1];
  const pre = match[2];

  // Map common semver pre-release labels to PEP 440 equivalents
  const pep440 = pre
    .replace(/^alpha\.?/,  "a")
    .replace(/^beta\.?/,   "b")
    .replace(/^rc\.?/,     "rc")
    .replace(/\./g,        "");

  return `${base}${pep440}`;
}

/**
 * Strip pre-release suffix, returning only the base X.Y.Z.
 * Used for manifests that don't support pre-release versions
 * (Chrome extension manifest.json, Tauri config).
 */
export function baseVersion(version: string): string {
  return version.replace(/-.*$/, "");
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
  const packageDirs: string[] = [];
  for (const group of packageGroups) {
    const groupDir = join(packageBase, group);
    const entries = readdirSync(groupDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(groupDir, entry.name))
      .filter((dir) => existsSync(join(dir, "package.json")));
    packageDirs.push(...entries);
  }
  packageDirs.sort();

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
