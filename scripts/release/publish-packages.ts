import { getReleaseVersion, getNpmTag, getTypeScriptPackages, runCommand, sortPackagesForPublish } from "./shared";

const version = getReleaseVersion(process.argv[2] ?? process.env.RELEASE_VERSION);
const registry = process.env.NPM_REGISTRY_URL ?? "https://registry.npmjs.org";
const packages = sortPackagesForPublish(getTypeScriptPackages());

async function isAlreadyPublished(name: string, publishedVersion: string): Promise<boolean> {
  const packagePath = name.startsWith("@")
    ? name.replace("/", "%2f")
    : encodeURIComponent(name);
  const response = await fetch(`${registry.replace(/\/$/, "")}/${packagePath}/${publishedVersion}`);

  if (response.status === 404) {
    return false;
  }

  if (!response.ok) {
    throw new Error(
      `Unable to check npm version for ${name}@${publishedVersion}: ${response.status} ${await response.text()}`,
    );
  }

  return true;
}

for (const pkg of packages) {
  console.log(`\n==> ${pkg.manifest.name}`);

  if (pkg.manifest.scripts?.build) {
    runCommand("bun", ["run", "build"], pkg.dir);
  } else {
    console.log("Skipping build (no build script)");
  }

  if (await isAlreadyPublished(pkg.manifest.name, version)) {
    console.log(`Skipping publish, ${pkg.manifest.name}@${version} already exists.`);
    continue;
  }

  const tag = process.env.NPM_TAG ?? getNpmTag(version);
  const publishArgs = ["publish", "--access", "public", "--tag", tag];

  runCommand("npm", publishArgs, pkg.dir);
}
