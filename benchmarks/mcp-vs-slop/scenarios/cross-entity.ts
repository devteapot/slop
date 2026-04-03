import type { Scenario, VerificationResult } from "./types";
import type { IssueTrackerStore } from "../app/store";

/**
 * Scenario: Reasoning across entities — the agent must correlate information
 * from one node to act on another.
 *
 * SLOP advantage: The full tree shows comments inline with issues. The agent
 * can read a comment that mentions another issue and navigate to it. All the
 * cross-referencing data is already in context.
 *
 * MCP disadvantage: The agent must read comments via list_comments, parse
 * references, then call get_issue on the referenced issue. Multiple
 * discovery round trips to connect the dots.
 */
export const crossEntity: Scenario = {
  name: "cross-entity",
  description: "Use information from comments to act on related issues across repos",
  agentPrompt:
    'I need you to investigate and connect some related issues:\n\n' +
    '1. Look at issue-6 in the backend repo (rate limiting on /api/search). Read its comments to understand the root cause.\n' +
    '2. The comment on issue-6 mentions the middleware ordering problem. Issue-3 in the frontend repo is about auth token refresh, which also involves middleware. Add a comment from "agent" on issue-3 saying "This may be related to the middleware ordering issue found in issue-6 (backend). The auth middleware and rate limiter may have the same root cause."\n' +
    '3. Since both issues are middleware-related, add the label "middleware" to both issue-6 and issue-3.\n' +
    '4. Both issues are security-sensitive. Make sure both have the "security" label (check first — one of them might already have it).\n' +
    '5. Assign both issues to the same person — whoever is NOT currently assigned to either. Pick someone from the team: alice, bob, or charlie.',

  steps: [
    {
      name: "cross_entity_actions",
      async slop() {},
      async mcp() {},
    },
  ],

  verify(store: IssueTrackerStore): VerificationResult {
    const issue3 = store.getIssue("issue-3");
    const issue6 = store.getIssue("issue-6");
    const comments3 = store.listComments("issue-3");
    const agentComment = comments3.find((c) => c.author === "agent");

    // issue-3 originally: labels: ["bug", "security"], assignee: null
    // issue-6 originally: labels: ["bug", "security"], assignee: null

    const checks = [
      {
        name: "Agent commented on issue-3 referencing issue-6",
        passed: agentComment !== undefined &&
          (agentComment.body.includes("issue-6") || agentComment.body.includes("issue 6")),
        detail: agentComment ? `"${agentComment.body.slice(0, 60)}..."` : "no agent comment",
      },
      {
        name: "issue-3 has 'middleware' label",
        passed: issue3?.labels.includes("middleware") ?? false,
        detail: `labels: ${issue3?.labels.join(", ")}`,
      },
      {
        name: "issue-6 has 'middleware' label",
        passed: issue6?.labels.includes("middleware") ?? false,
        detail: `labels: ${issue6?.labels.join(", ")}`,
      },
      {
        name: "issue-3 has 'security' label",
        passed: issue3?.labels.includes("security") ?? false,
        detail: `labels: ${issue3?.labels.join(", ")}`,
      },
      {
        name: "issue-6 has 'security' label",
        passed: issue6?.labels.includes("security") ?? false,
        detail: `labels: ${issue6?.labels.join(", ")}`,
      },
      {
        name: "Both issues assigned to same person",
        passed: issue3?.assignee !== null &&
          issue6?.assignee !== null &&
          issue3?.assignee === issue6?.assignee,
        detail: `issue-3: ${issue3?.assignee}, issue-6: ${issue6?.assignee}`,
      },
      {
        name: "Assignee is from the team (alice, bob, or charlie)",
        passed: ["alice", "bob", "charlie"].includes(issue3?.assignee ?? ""),
        detail: `assignee: ${issue3?.assignee}`,
      },
    ];

    return { passed: checks.every((c) => c.passed), checks };
  },
};
