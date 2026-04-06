import { describe, expect, test } from "bun:test";

import { buildComponents, computeAffected, computeCiJobPlan } from "./preflight";

const components = buildComponents();

function getCiJobPlan(changedFiles: string[]) {
  const { ordered, repoWide } = computeAffected(components, changedFiles, false);
  return computeCiJobPlan(ordered, changedFiles, repoWide);
}

describe("preflight CI detection", () => {
  test("root Bun dependency changes only trigger Bun-backed jobs", () => {
    const plan = getCiJobPlan(["package.json"]);

    expect(plan.run_biome_format).toBe(false);
    expect(plan.run_typescript_packages).toBe(true);
    expect(plan.run_extension).toBe(true);
    expect(plan.run_docs).toBe(true);
    expect(plan.run_landing).toBe(true);
    expect(plan.run_demo).toBe(true);
    expect(plan.run_playground).toBe(true);
    expect(plan.run_desktop_macos).toBe(true);
    expect(plan.run_python_sdk).toBe(false);
    expect(plan.run_rust_sdk).toBe(false);
    expect(plan.run_go_sdk).toBe(false);
  });

  test("Rust SDK changes propagate to desktop but not other language jobs", () => {
    const plan = getCiJobPlan(["packages/rust/slop-ai/Cargo.toml"]);

    expect(plan.run_biome_format).toBe(false);
    expect(plan.run_typescript_packages).toBe(false);
    expect(plan.run_extension).toBe(false);
    expect(plan.run_docs).toBe(false);
    expect(plan.run_landing).toBe(false);
    expect(plan.run_demo).toBe(false);
    expect(plan.run_playground).toBe(false);
    expect(plan.run_desktop_macos).toBe(true);
    expect(plan.run_python_sdk).toBe(false);
    expect(plan.run_rust_sdk).toBe(true);
    expect(plan.run_go_sdk).toBe(false);
  });

  test("Biome config changes only trigger the formatting job", () => {
    const plan = getCiJobPlan(["biome.json"]);

    expect(plan.run_biome_format).toBe(true);
    expect(plan.run_typescript_packages).toBe(false);
    expect(plan.run_extension).toBe(false);
    expect(plan.run_docs).toBe(false);
    expect(plan.run_landing).toBe(false);
    expect(plan.run_demo).toBe(false);
    expect(plan.run_playground).toBe(false);
    expect(plan.run_desktop_macos).toBe(false);
    expect(plan.run_python_sdk).toBe(false);
    expect(plan.run_rust_sdk).toBe(false);
    expect(plan.run_go_sdk).toBe(false);
  });

  test("root TypeScript build script changes trigger only jobs that use it", () => {
    const plan = getCiJobPlan(["scripts/build-typescript-packages.ts"]);

    expect(plan.run_biome_format).toBe(true);
    expect(plan.run_typescript_packages).toBe(true);
    expect(plan.run_extension).toBe(false);
    expect(plan.run_docs).toBe(false);
    expect(plan.run_landing).toBe(false);
    expect(plan.run_demo).toBe(true);
    expect(plan.run_playground).toBe(true);
    expect(plan.run_desktop_macos).toBe(false);
    expect(plan.run_python_sdk).toBe(false);
    expect(plan.run_rust_sdk).toBe(false);
    expect(plan.run_go_sdk).toBe(false);
  });

  test("TypeScript source changes trigger the Biome formatter job", () => {
    const plan = getCiJobPlan(["packages/typescript/sdk/core/src/index.ts"]);

    expect(plan.run_biome_format).toBe(true);
    expect(plan.run_typescript_packages).toBe(true);
  });

  test("Biome excludes do not trigger the formatter job", () => {
    const plan = getCiJobPlan(["examples/full-stack/tanstack-start/src/routeTree.gen.ts"]);

    expect(plan.run_biome_format).toBe(false);
  });

  test("workflow changes force every preflight job to run", () => {
    const plan = getCiJobPlan([".github/workflows/preflight.yml"]);

    for (const shouldRun of Object.values(plan)) {
      expect(shouldRun).toBe(true);
    }
  });
});
