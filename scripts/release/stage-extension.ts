import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getStableReleaseVersion, repoRoot } from "./shared";

const version = getStableReleaseVersion(process.argv[2] ?? process.env.RELEASE_VERSION);
const extensionRoot = join(repoRoot, "apps", "extension");
const distDir = join(extensionRoot, "dist");
const stageDir = join(repoRoot, "artifacts", `slop-extension-${version}`);

for (const requiredPath of [
  join(extensionRoot, "manifest.json"),
  join(extensionRoot, "options.html"),
  join(extensionRoot, "popup.html"),
  join(extensionRoot, "icons"),
  distDir,
]) {
  if (!existsSync(requiredPath)) {
    throw new Error(`Missing extension release file: ${requiredPath}`);
  }
}

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

cpSync(join(extensionRoot, "manifest.json"), join(stageDir, "manifest.json"));
cpSync(join(extensionRoot, "options.html"), join(stageDir, "options.html"));
cpSync(join(extensionRoot, "icons"), join(stageDir, "icons"), { recursive: true });
cpSync(distDir, join(stageDir, "dist"), { recursive: true });

const popupTemplate = readFileSync(join(extensionRoot, "popup.html"), "utf8");
const popupHtml = popupTemplate.replace(
  /<span class="version">v[^<]+<\/span>/,
  `<span class="version">v${version}</span>`,
);
writeFileSync(join(stageDir, "popup.html"), popupHtml);

console.log(`Extension bundle staged at ${stageDir}`);
