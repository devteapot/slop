import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getReleaseVersion, repoRoot, runCommand } from "./shared";

const version = getReleaseVersion(process.argv[2] ?? process.env.RELEASE_VERSION);
const crateDir = join(repoRoot, "packages", "rust", "slop-ai");
const cargoTomlPath = join(crateDir, "Cargo.toml");
const crateName = "slop-ai";

async function isAlreadyPublished(name: string, publishedVersion: string): Promise<boolean> {
  const response = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}/${publishedVersion}`);
  if (response.status === 404) {
    return false;
  }

  if (!response.ok) {
    throw new Error(`Unable to check crates.io version for ${name}: ${response.status} ${await response.text()}`);
  }

  return true;
}

const cargoToml = readFileSync(cargoTomlPath, "utf8");
if (!cargoToml.includes(`version = "${version}"`)) {
  throw new Error(`Expected ${cargoTomlPath} to be synced to ${version} before publishing.`);
}

if (await isAlreadyPublished(crateName, version)) {
  console.log(`Skipping publish, ${crateName} ${version} already exists on crates.io.`);
  process.exit(0);
}

if (!process.env.CARGO_REGISTRY_TOKEN) {
  throw new Error("CARGO_REGISTRY_TOKEN is required to publish the Rust crate.");
}

runCommand("cargo", ["publish", "--allow-dirty"], crateDir);
