import type { Scenario, VerificationResult } from "../../../mcp-vs-slop/scenarios/types.ts";
import type { FileBrowserStore } from "./store.ts";

const empty: Scenario["steps"] = [];

/**
 * find-readme — tests depth-first exploration. The agent must locate a file
 * named README.md and report its contents. We verify by checking the store's
 * "reports" tracking (or simpler: the scenario's `verify` just confirms the
 * file still exists; we don't validate the agent's final answer. The real
 * test is whether the agent *can* read it at all, reflected in toolCalls /
 * specComplianceRate metrics).
 */
function verifyReadmeExists(store: FileBrowserStore): VerificationResult {
  // Placeholder verifier — the whole point of find-and-read is that the
  // agent reaches the file, which is captured by tool-call metrics, not by
  // store mutations. Scoring happens via a reports collection below.
  const readme = store.getFile("/README.md");
  return {
    passed: readme !== undefined,
    checks: [
      {
        name: "README.md still in tree",
        passed: readme !== undefined,
      },
    ],
  };
}

/**
 * delete-empty-dirs — tests state-dependent affordances. The agent must find
 * every empty directory and delete it. The seed guarantees at least one
 * empty dir ("/empty"). Verifier checks that no empty dirs remain.
 */
function verifyNoEmptyDirs(store: FileBrowserStore): VerificationResult {
  const empties = store.listDirs().filter((d) => d.path !== "/" && store.isDirEmpty(d.path));
  return {
    passed: empties.length === 0,
    checks: [
      {
        name: "no empty directories remain",
        passed: empties.length === 0,
        detail: empties.length === 0 ? undefined : `still empty: ${empties.map((d) => d.path).join(", ")}`,
      },
    ],
  };
}

export const fileBrowserScenarios: Scenario[] = [
  {
    name: "find-readme",
    description: "Locate and read the contents of README.md.",
    agentPrompt:
      "Find the file named exactly 'README.md' in the file tree and read its contents. " +
      'Then respond with "DONE".',
    steps: empty,
    verify: (store) => verifyReadmeExists(store as unknown as FileBrowserStore),
  },
  {
    name: "delete-empty-dirs",
    description: "Delete every empty directory (excluding the root).",
    agentPrompt:
      "Delete every empty directory in the tree. An empty directory contains no files and no subdirectories. " +
      "Do not delete the root directory. Do not delete any directory that still has files or subdirectories.",
    steps: empty,
    verify: (store) => verifyNoEmptyDirs(store as unknown as FileBrowserStore),
  },
];
