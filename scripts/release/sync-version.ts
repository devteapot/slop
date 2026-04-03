import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  baseVersion,
  getReleaseVersion,
  getTypeScriptPackages,
  isPrerelease,
  readJson,
  replaceVersionInToml,
  repoRoot,
  toPep440,
  updateInternalDependencyVersions,
  writeJson,
  type PackageManifest,
} from "./shared";

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes("--dry-run");
const versionArg = rawArgs.find((arg) => !arg.startsWith("--"));
const version = getReleaseVersion(versionArg ?? process.env.RELEASE_VERSION);
const appVersion = baseVersion(version);
const pythonVersion = toPep440(version);

const writeOps: string[] = [];

function saveJson(filePath: string, value: unknown): void {
  writeOps.push(filePath);
  if (!dryRun) {
    writeJson(filePath, value);
  }
}

function saveText(filePath: string, value: string): void {
  writeOps.push(filePath);
  if (!dryRun) {
    writeFileSync(filePath, value);
  }
}

const packages = getTypeScriptPackages();
const workspaceNames = new Set(packages.map((pkg) => pkg.manifest.name));

for (const pkg of packages) {
  const manifest = readJson<PackageManifest>(pkg.manifestPath);
  manifest.version = version;
  updateInternalDependencyVersions(manifest, version, workspaceNames);
  saveJson(pkg.manifestPath, manifest);
}

const extensionPackagePath = join(repoRoot, "apps", "extension", "package.json");
const extensionPackage = readJson<PackageManifest>(extensionPackagePath);
extensionPackage.version = appVersion;
saveJson(extensionPackagePath, extensionPackage);

const extensionManifestPath = join(repoRoot, "apps", "extension", "manifest.json");
const extensionManifest = readJson<Record<string, unknown>>(extensionManifestPath);
extensionManifest.version = appVersion;
saveJson(extensionManifestPath, extensionManifest);

const desktopPackagePath = join(repoRoot, "apps", "desktop", "package.json");
const desktopPackage = readJson<PackageManifest>(desktopPackagePath);
desktopPackage.version = appVersion;
saveJson(desktopPackagePath, desktopPackage);

const tauriConfigPath = join(repoRoot, "apps", "desktop", "src-tauri", "tauri.conf.json");
const tauriConfig = readJson<Record<string, unknown>>(tauriConfigPath);
tauriConfig.version = appVersion;
saveJson(tauriConfigPath, tauriConfig);

function syncToml(filePath: string, newVersion: string, section: string): void {
  const content = readFileSync(filePath, "utf8");
  const updated = replaceVersionInToml(content, newVersion, section);

  if (updated !== content) {
    saveText(filePath, updated);
  } else if (!content.includes(`version = "${newVersion}"`)) {
    throw new Error(`Failed to update version in ${filePath}`);
  }
}

syncToml(join(repoRoot, "apps", "desktop", "src-tauri", "Cargo.toml"), appVersion, "package");
syncToml(join(repoRoot, "packages", "rust", "slop-ai", "Cargo.toml"), version, "package");
syncToml(join(repoRoot, "packages", "python", "slop-ai", "pyproject.toml"), pythonVersion, "project");

console.log(
  `${dryRun ? "Would update" : "Updated"} ${writeOps.length} files for release ${version}.`,
);
for (const filePath of writeOps) {
  console.log(`- ${filePath}`);
}
