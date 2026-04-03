import type { Scenario, VerificationResult } from "./types";
import type { IssueTrackerStore } from "../app/store";

/**
 * Scenario: Recovery after an impossible action.
 *
 * The agent is asked to do something impossible, then immediately asked
 * to do something valid. Tests whether the agent can:
 * 1. Recognize the first action is impossible
 * 2. Recover gracefully
 * 3. Successfully complete the valid action
 *
 * SLOP advantage: Affordances make it immediately clear what's possible.
 * The agent never needs to "try and fail" — it can see from the tree
 * that the action isn't available. Recovery is instant because the
 * agent's context is already correct.
 *
 * MCP disadvantage: The agent might try the impossible action, get an error,
 * then need to re-orient before attempting the valid action. This burns
 * extra round trips and tokens.
 */
export const recovery: Scenario = {
  name: "recovery",
  description: "Recover from impossible action then perform a valid one",
  agentPrompt:
    'I need you to do two things:\n\n' +
    '1. First, try to merge pull request #42 in the frontend repo. I think there should be a merge action available.\n\n' +
    '2. After that, regardless of whether the merge worked, find the open issue about "login form" validation in the frontend repo (issue-1), ' +
    'add a comment from "agent" saying "Investigated: the email regex is missing TLD validation. Fix incoming.", ' +
    'assign it to "bob", and add the "in-progress" label.\n\n' +
    'If the first task is not possible, explain why and move on to the second task immediately.',

  steps: [
    {
      name: "recovery_actions",
      async slop(_consumer, _subId, _snapshot) {
        // Agent-only test
      },
      async mcp(_client) {
        // Agent-only test
      },
    },
  ],

  verify(store: IssueTrackerStore): VerificationResult {
    const issue1 = store.getIssue("issue-1");
    const comments = store.listComments("issue-1");
    const agentComment = comments.find((c) => c.author === "agent");

    const checks = [
      {
        // The merge action doesn't exist — state should be unmodified from that attempt
        name: "No merge side effects (issue count unchanged)",
        passed: store.issues.length === 15,
        detail: `issue count: ${store.issues.length}`,
      },
      {
        // The valid action: comment added
        name: "Comment added to issue-1 from 'agent'",
        passed: agentComment !== undefined,
        detail: agentComment
          ? `"${agentComment.body.slice(0, 50)}..."`
          : "no agent comment found",
      },
      {
        // Comment content mentions the fix
        name: "Comment mentions TLD validation or regex",
        passed: agentComment
          ? (agentComment.body.toLowerCase().includes("tld") ||
             agentComment.body.toLowerCase().includes("regex") ||
             agentComment.body.toLowerCase().includes("validation"))
          : false,
        detail: agentComment ? `"${agentComment.body.slice(0, 60)}"` : "no comment",
      },
      {
        // Assigned to bob
        name: "issue-1 assigned to bob",
        passed: issue1?.assignee === "bob",
        detail: `assignee: ${issue1?.assignee ?? "null"}`,
      },
      {
        // in-progress label added
        name: "issue-1 has 'in-progress' label",
        passed: issue1?.labels.includes("in-progress") ?? false,
        detail: `labels: ${issue1?.labels.join(", ") ?? "none"}`,
      },
      {
        // Issue still open (agent shouldn't have closed it)
        name: "issue-1 still open",
        passed: issue1?.status === "open",
        detail: `status: ${issue1?.status}`,
      },
    ];

    return { passed: checks.every((c) => c.passed), checks };
  },
};
