import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getStableReleaseVersion,
  getTypeScriptPackages,
  readJson,
  replaceVersionInToml,
  repoRoot,
  updateInternalDependencyVersions,
  writeJson,
  type PackageManifest,
} from "./shared";

const rawArgs = process.argv.slice(2);
const dryRun = rawArgs.includes("--dry-run");
const versionArg = rawArgs.find((arg) => !arg.startsWith("--"));
const version = getStableReleaseVersion(versionArg ?? process.env.RELEASE_VERSION);

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
extensionPackage.version = version;
saveJson(extensionPackagePath, extensionPackage);

const extensionManifestPath = join(repoRoot, "apps", "extension", "manifest.json");
const extensionManifest = readJson<Record<string, unknown>>(extensionManifestPath);
extensionManifest.version = version;
saveJson(extensionManifestPath, extensionManifest);

const desktopPackagePath = join(repoRoot, "apps", "desktop", "package.json");
const desktopPackage = readJson<PackageManifest>(desktopPackagePath);
desktopPackage.version = version;
saveJson(desktopPackagePath, desktopPackage);

const tauriConfigPath = join(repoRoot, "apps", "desktop", "src-tauri", "tauri.conf.json");
const tauriConfig = readJson<Record<string, unknown>>(tauriConfigPath);
tauriConfig.version = version;
saveJson(tauriConfigPath, tauriConfig);

const cargoTomlPath = join(repoRoot, "apps", "desktop", "src-tauri", "Cargo.toml");
const cargoToml = readFileSync(cargoTomlPath, "utf8");
const nextCargoToml = replaceVersionInToml(cargoToml, version, "package");

if (nextCargoToml === cargoToml) {
  throw new Error(`Failed to update version in ${cargoTomlPath}`);
}

saveText(cargoTomlPath, nextCargoToml);

const rustCargoTomlPath = join(repoRoot, "packages", "rust", "slop-ai", "Cargo.toml");
const rustCargoToml = readFileSync(rustCargoTomlPath, "utf8");
const nextRustCargoToml = replaceVersionInToml(rustCargoToml, version, "package");

if (nextRustCargoToml === rustCargoToml) {
  throw new Error(`Failed to update version in ${rustCargoTomlPath}`);
}

saveText(rustCargoTomlPath, nextRustCargoToml);

const pythonPyprojectPath = join(repoRoot, "packages", "python", "slop-ai", "pyproject.toml");
const pythonPyproject = readFileSync(pythonPyprojectPath, "utf8");
const nextPythonPyproject = replaceVersionInToml(pythonPyproject, version, "project");

if (nextPythonPyproject === pythonPyproject) {
  throw new Error(`Failed to update version in ${pythonPyprojectPath}`);
}

saveText(pythonPyprojectPath, nextPythonPyproject);

console.log(
  `${dryRun ? "Would update" : "Updated"} ${writeOps.length} files for release ${version}.`,
);
for (const filePath of writeOps) {
  console.log(`- ${filePath}`);
}
