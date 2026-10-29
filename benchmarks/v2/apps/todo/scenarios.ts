import type { Scenario, VerificationResult } from "../../../mcp-vs-slop/scenarios/types.ts";
import type { TodoStore } from "./store.ts";

/**
 * Todo scenarios are deliberately simple — they test the floor of the
 * complexity ladder. If SLOP's advantages shrink here we want to see it.
 * Each verifier is scale-independent: it checks predicates across whatever
 * tasks the store was seeded with, not a fixed count.
 */

// Scenarios conform to v1's Scenario type to reuse the AppBinding surface —
// the `steps` field is only exercised in scripted mode (not used in v2 yet)
// so we provide empty arrays.

const empty: Scenario["steps"] = [];

function verifyAllDone(store: TodoStore): VerificationResult {
  const notDone = store.tasks.filter((t) => !t.done);
  return {
    passed: notDone.length === 0,
    checks: [
      {
        name: "all tasks are done",
        passed: notDone.length === 0,
        detail: notDone.length === 0 ? undefined : `${notDone.length} tasks still undone`,
      },
    ],
  };
}

function verifyOnlyUndoneRemain(store: TodoStore): VerificationResult {
  const done = store.tasks.filter((t) => t.done);
  return {
    passed: done.length === 0,
    checks: [
      {
        name: "no done tasks remain",
        passed: done.length === 0,
        detail: done.length === 0 ? undefined : `${done.length} done tasks were not deleted`,
      },
    ],
  };
}

function verifyBugsHighPriority(store: TodoStore): VerificationResult {
  const bugs = store.tasks.filter((t) => t.tag === "bug");
  const nonHigh = bugs.filter((t) => t.priority !== "high");
  // Non-bug tasks are seeded with priority <= medium, so any non-bug that's
  // now high means the agent touched a task it shouldn't have.
  const nonBugsPromoted = store.tasks.filter((t) => t.tag !== "bug" && t.priority === "high");
  return {
    passed: nonHigh.length === 0 && nonBugsPromoted.length === 0,
    checks: [
      {
        name: "every bug tagged task is priority=high",
        passed: nonHigh.length === 0,
        detail: nonHigh.length === 0 ? undefined : `${nonHigh.length} bug tasks not high priority`,
      },
      {
        name: "no non-bug tasks elevated to high",
        passed: nonBugsPromoted.length === 0,
        detail: nonBugsPromoted.length === 0 ? undefined : `${nonBugsPromoted.length} non-bug tasks incorrectly promoted`,
      },
    ],
  };
}

export const todoScenarios: Scenario[] = [
  {
    name: "mark-all-done",
    description: "Mark every task as done, touching each task exactly once.",
    agentPrompt: "Mark every task as done. Don't skip any. Don't delete or modify anything else.",
    steps: empty,
    verify: (store) => verifyAllDone(store as unknown as TodoStore),
  },
  {
    name: "delete-completed",
    description: "Delete every already-done task, leaving only undone tasks.",
    agentPrompt:
      "Delete every task that is already marked done. Leave the undone tasks untouched.",
    steps: empty,
    verify: (store) => verifyOnlyUndoneRemain(store as unknown as TodoStore),
  },
  {
    name: "prioritize-bugs",
    description: "Set priority=high on every task tagged as 'bug'.",
    agentPrompt: "For every task tagged as 'bug', set its priority to high. Don't touch any other tasks.",
    steps: empty,
    verify: (store) => verifyBugsHighPriority(store as unknown as TodoStore),
  },
];
