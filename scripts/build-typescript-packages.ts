import { getTypeScriptPackages, runCommand } from "./release/shared";

for (const pkg of getTypeScriptPackages()) {
  if (!pkg.manifest.scripts?.build) {
    console.log(`Skipping ${pkg.manifest.name} (no build script)`);
    continue;
  }

  console.log(`Building ${pkg.manifest.name}`);
  runCommand("bun", ["run", "build"], pkg.dir);
}
