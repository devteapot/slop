import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getReleaseVersion, toPep440, repoRoot, runCommand } from "./shared";

const version = getReleaseVersion(process.argv[2] ?? process.env.RELEASE_VERSION);
const pypiVersion = toPep440(version);
const packageDir = join(repoRoot, "packages", "python", "slop-ai");
const distDir = join(packageDir, "dist");
const pyprojectPath = join(packageDir, "pyproject.toml");
const packageName = "slop-ai";
const pythonBin = process.env.PYTHON_BIN ?? "python3";

async function isAlreadyPublished(name: string, publishedVersion: string): Promise<boolean> {
  const response = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/${publishedVersion}/json`);
  if (response.status === 404) {
    return false;
  }

  if (!response.ok) {
    throw new Error(`Unable to check PyPI version for ${name}: ${response.status} ${await response.text()}`);
  }

  return true;
}

const pyprojectText = readFileSync(pyprojectPath, "utf8");
if (!pyprojectText.includes(`version = "${pypiVersion}"`)) {
  throw new Error(`Expected ${pyprojectPath} to be synced to ${pypiVersion} before publishing.`);
}

if (await isAlreadyPublished(packageName, pypiVersion)) {
  console.log(`Skipping publish, ${packageName} ${pypiVersion} already exists on PyPI.`);
  process.exit(0);
}

if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}

runCommand(pythonBin, ["-m", "build"], packageDir);

const distFiles = existsSync(distDir)
  ? readdirSync(distDir).filter((fileName) => fileName.endsWith(".whl") || fileName.endsWith(".tar.gz"))
  : [];

if (!distFiles.some((fileName) => fileName.endsWith(".whl")) || !distFiles.some((fileName) => fileName.endsWith(".tar.gz"))) {
  throw new Error(`Expected both sdist and wheel artifacts in ${distDir}.`);
}

const twineEnv = {
  ...process.env,
  TWINE_USERNAME: process.env.TWINE_USERNAME ?? "__token__",
  TWINE_PASSWORD: process.env.TWINE_PASSWORD ?? process.env.PYPI_API_TOKEN,
};

if (!twineEnv.TWINE_PASSWORD) {
  throw new Error("PYPI_API_TOKEN or TWINE_PASSWORD is required to publish the Python package.");
}

runCommand(
  pythonBin,
  ["-m", "twine", "upload", ...distFiles.map((fileName) => `dist/${fileName}`)],
  packageDir,
  twineEnv,
);
