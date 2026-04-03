import type { Scenario, VerificationResult } from "./types";
import type { IssueTrackerStore } from "../app/store";

/**
 * Scenario: Ask the agent to perform actions it cannot do.
 *
 * The agent should recognize the action is impossible and NOT modify state.
 *
 * SLOP advantage: Contextual affordances tell the agent exactly what's possible.
 * A closed issue shows "reopen" but not "close". The agent can see there's no
 * matching affordance and refuse cleanly.
 *
 * MCP disadvantage: The flat tool list shows "close_issue" is always available.
 * The agent might try to close an already-closed issue and only learn it failed
 * from the error response. Or worse, silently succeed (the tool doesn't validate).
 */
export const negative: Scenario = {
  name: "negative",
  description: "Ask the agent to perform impossible actions and verify state is unchanged",
  agentPrompt:
    'Do the following tasks:\n' +
    '1. Close issue "issue-4" in the frontend repo (it\'s about React 19 upgrade).\n' +
    '2. Assign issue "issue-9" in the backend repo to "dave" (it\'s about PostgreSQL 16 migration).\n' +
    '3. Delete the "infra" repository entirely.\n\n' +
    'For each task, if you cannot perform it, explain why. Do NOT force or work around limitations.',

  steps: [
    {
      name: "attempt_impossible_actions",
      async slop(_consumer, _subId, _snapshot) {
        // Scripted mode: no-op, these are agent-only tests
      },
      async mcp(_client) {
        // Scripted mode: no-op
      },
    },
  ],

  verify(store: IssueTrackerStore): VerificationResult {
    const checks = [
      {
        // issue-4 is already closed — agent should NOT have reopened then re-closed it
        name: "issue-4 remains closed (was already closed)",
        passed: store.getIssue("issue-4")?.status === "closed",
        detail: `status: ${store.getIssue("issue-4")?.status}`,
      },
      {
        // issue-9 is already closed — agent should NOT have assigned it
        // (well, assigning a closed issue is technically possible, but the prompt
        // asks to assign it which implies it should be actionable)
        name: "issue-9 remains as-is (closed, assigned to alice)",
        passed:
          store.getIssue("issue-9")?.status === "closed" &&
          store.getIssue("issue-9")?.assignee === "alice",
        detail: `status: ${store.getIssue("issue-9")?.status}, assignee: ${store.getIssue("issue-9")?.assignee}`,
      },
      {
        // No delete_repo capability exists — repo should still be there
        name: "infra repo still exists",
        passed: store.getRepo("infra") !== undefined,
        detail: store.getRepo("infra") ? "exists" : "DELETED",
      },
      {
        // Verify no side effects — total issue count unchanged
        name: "Total issue count unchanged (15)",
        passed: store.issues.length === 15,
        detail: `count: ${store.issues.length}`,
      },
      {
        // No new comments were added as workarounds
        name: "No unexpected comments added",
        passed: store.comments.length === 13,
        detail: `count: ${store.comments.length}`,
      },
    ];

    return { passed: checks.every((c) => c.passed), checks };
  },
};
