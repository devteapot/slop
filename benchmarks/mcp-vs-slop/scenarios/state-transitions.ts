import type { Scenario, VerificationResult } from "./types";
import type { IssueTrackerStore } from "../app/store";

/**
 * Scenario: Actions that change available affordances, requiring the agent
 * to adapt its plan based on the new state.
 *
 * SLOP advantage: After closing an issue, the subscription patches update
 * the tree — the "close" affordance disappears and "reopen" appears.
 * The agent's tool list rebuilds to reflect the new reality.
 *
 * MCP disadvantage: The flat tool list never changes. "close_issue" and
 * "reopen_issue" are always available. The agent must track state mentally
 * to know which one to call. If it calls the wrong one, it gets an
 * inconsistent result.
 */
export const stateTransitions: Scenario = {
  name: "state-transitions",
  description: "Close an issue, verify state changed, reopen it, then close a different one",
  agentPrompt:
    'Perform these steps in order:\n' +
    '1. Close issue-1 in the frontend repo (the login form validation bug).\n' +
    '2. Verify that issue-1 is now closed by checking its status.\n' +
    '3. Actually, we still need that fix — reopen issue-1.\n' +
    '4. Add a comment from "agent" on issue-1 saying "Reopened — this is still a priority."\n' +
    '5. Now close issue-5 instead (the deprecated API calls issue in frontend, labeled wontfix).\n' +
    '6. Add the "wontfix" label to issue-1 as well, since we\'re deprioritizing validation fixes.\n\n' +
    'Complete all steps in order.',

  steps: [
    {
      name: "state_transition_actions",
      async slop() {},
      async mcp() {},
    },
  ],

  verify(store: IssueTrackerStore): VerificationResult {
    const issue1 = store.getIssue("issue-1");
    const issue5 = store.getIssue("issue-5");
    const comments1 = store.listComments("issue-1");
    const agentComment = comments1.find((c) => c.author === "agent");

    const checks = [
      {
        name: "issue-1 is open (was closed then reopened)",
        passed: issue1?.status === "open",
        detail: `status: ${issue1?.status}`,
      },
      {
        name: "issue-1 has agent comment about reopening",
        passed: agentComment !== undefined && agentComment.body.toLowerCase().includes("reopen"),
        detail: agentComment ? `"${agentComment.body.slice(0, 50)}"` : "no agent comment",
      },
      {
        name: "issue-5 is closed",
        passed: issue5?.status === "closed",
        detail: `status: ${issue5?.status}`,
      },
      {
        name: "issue-1 has 'wontfix' label",
        passed: issue1?.labels.includes("wontfix") ?? false,
        detail: `labels: ${issue1?.labels.join(", ")}`,
      },
      {
        name: "issue-1 still has original 'bug' label",
        passed: issue1?.labels.includes("bug") ?? false,
        detail: `labels: ${issue1?.labels.join(", ")}`,
      },
    ];

    return { passed: checks.every((c) => c.passed), checks };
  },
};
