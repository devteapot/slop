import type { Scenario, VerificationResult } from "./types";
import type { IssueTrackerStore } from "../app/store";

/**
 * Scenario: Multi-turn contextual actions.
 *
 * The agent must understand context from prior actions:
 * - Create an issue, then refer to it as "this issue" without specifying the ID
 * - Encounter a dangerous/disruptive action and handle confirmation
 *
 * SLOP advantage: After creating an issue, the state tree updates via patches.
 * The new issue appears with its affordances. The agent can see "this issue"
 * in context because it's the most recently changed node.
 *
 * MCP disadvantage: After creating an issue, the agent gets back an ID.
 * It must track this ID across turns to refer to "this issue". There's no
 * ambient context — just a flat response.
 */
export const contextual: Scenario = {
  name: "contextual",
  description: "Multi-turn contextual actions: create, refer by context, handle confirmation",
  agentPrompt:
    'Perform these steps in order:\n' +
    '1. Create a new issue in the "backend" repo titled "API rate limiting needs overhaul" with body "Current rate limiter is per-IP but we need per-user rate limiting with configurable thresholds." and label it "feature".\n' +
    '2. For the issue you just created, add a comment from "agent" saying "I\'ll start by auditing the current rate limiting middleware."\n' +
    '3. For that same issue, also add the "security" label.\n' +
    '4. Now assign that issue to "charlie".\n' +
    '5. Finally, close issue "issue-6" in the backend repo (the one about rate limiting not working on /api/search).\n\n' +
    'Make sure you complete ALL steps. Refer to the issue you created by its actual ID, not by description.',

  steps: [
    {
      name: "contextual_actions",
      async slop(_consumer, _subId, _snapshot) {
        // Agent-only test
      },
      async mcp(_client) {
        // Agent-only test
      },
    },
  ],

  verify(store: IssueTrackerStore): VerificationResult {
    // Find the newly created issue
    const newIssue = store.issues.find(
      (i) => i.repoId === "backend" && i.title === "API rate limiting needs overhaul",
    );

    const checks = [
      {
        name: "New issue created in backend repo",
        passed: newIssue !== undefined,
        detail: newIssue ? `id: ${newIssue.id}` : "not found",
      },
      {
        name: "New issue has correct body",
        passed: newIssue?.body.includes("per-user rate limiting") ?? false,
        detail: newIssue ? `body: "${newIssue.body.slice(0, 50)}..."` : "no issue",
      },
      {
        name: "New issue has 'feature' label",
        passed: newIssue?.labels.includes("feature") ?? false,
        detail: `labels: ${newIssue?.labels.join(", ") ?? "none"}`,
      },
      {
        name: "Comment added from 'agent' on new issue",
        passed: newIssue
          ? store.listComments(newIssue.id).some((c) => c.author === "agent")
          : false,
        detail: newIssue
          ? `comments: ${store.listComments(newIssue.id).length}`
          : "no issue",
      },
      {
        name: "Comment mentions rate limiting middleware",
        passed: newIssue
          ? store.listComments(newIssue.id).some((c) =>
              c.body.toLowerCase().includes("rate limit"),
            )
          : false,
        detail: newIssue
          ? store.listComments(newIssue.id).map((c) => `"${c.body.slice(0, 40)}..."`).join(", ")
          : "no issue",
      },
      {
        name: "New issue has 'security' label added",
        passed: newIssue?.labels.includes("security") ?? false,
        detail: `labels: ${newIssue?.labels.join(", ") ?? "none"}`,
      },
      {
        name: "New issue assigned to charlie",
        passed: newIssue?.assignee === "charlie",
        detail: `assignee: ${newIssue?.assignee ?? "null"}`,
      },
      {
        name: "issue-6 closed",
        passed: store.getIssue("issue-6")?.status === "closed",
        detail: `status: ${store.getIssue("issue-6")?.status}`,
      },
    ];

    return { passed: checks.every((c) => c.passed), checks };
  },
};
