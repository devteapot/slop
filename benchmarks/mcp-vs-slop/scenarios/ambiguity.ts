import type { Scenario, VerificationResult } from "./types";
import type { IssueTrackerStore } from "../app/store";

/**
 * Scenario: Vague instructions that require the agent to disambiguate
 * by reasoning about the available state.
 *
 * SLOP advantage: The agent can see all issues simultaneously, compare
 * titles, labels, and content to figure out which issue the user means.
 * No discovery round trips needed.
 *
 * MCP disadvantage: The agent must search or list issues, read multiple
 * results, compare them, and decide — burning tool calls on disambiguation.
 */
export const ambiguity: Scenario = {
  name: "ambiguity",
  description: "Resolve ambiguous references by reasoning about state",
  agentPrompt:
    'I need help with a few things, but I don\'t remember the exact issue numbers:\n\n' +
    '1. There\'s a bug about "connections" somewhere — I think it\'s about the database. Close it, it\'s been resolved.\n' +
    '2. The "upgrade" issue that\'s already done (closed) — add a comment from "agent" saying "Confirmed: upgrade completed successfully in prod."\n' +
    '3. Someone filed an issue about "Kubernetes" — assign it to "charlie" since he handles infra.\n' +
    '4. There are two issues about "rate limiting" across different repos. Add the label "p0-critical" to both of them.\n\n' +
    'Figure out which issues I\'m talking about and do the right thing.',

  steps: [
    {
      name: "ambiguity_actions",
      async slop() {},
      async mcp() {},
    },
  ],

  verify(store: IssueTrackerStore): VerificationResult {
    // Expected matches:
    // 1. "connections" + "database" → issue-8 "Database connection pool exhaustion" (backend)
    // 2. "upgrade" + closed → issue-9 "Migrate to PostgreSQL 16" (backend, closed) OR
    //                          issue-14 "Upgrade Kubernetes to 1.29" (infra, closed) OR
    //                          issue-4 "Update React to v19" (frontend, closed)
    //    Most likely: issue-9 (it's a migration/upgrade and is closed)
    // 3. "Kubernetes" → issue-14 "Upgrade Kubernetes to 1.29" (infra)
    // 4. "rate limiting" → issue-6 "Rate limiting not working on /api/search" (backend)
    //    AND potentially issue-7 "Add pagination" mentions rate... no.
    //    The only rate limiting issue is issue-6. But the prompt says "two issues."
    //    There's no second rate limiting issue in the seed data.
    //    This tests whether the agent honestly reports it can only find one.

    const issue8 = store.getIssue("issue-8");
    const issue14 = store.getIssue("issue-14");
    const issue6 = store.getIssue("issue-6");

    // Check for upgrade comments on any closed issue
    const closedUpgradeIssues = ["issue-4", "issue-9", "issue-14"];
    const upgradeCommented = closedUpgradeIssues.some((id) =>
      store.listComments(id).some((c) => c.author === "agent" && c.body.toLowerCase().includes("upgrade")),
    );
    const whichUpgrade = closedUpgradeIssues.find((id) =>
      store.listComments(id).some((c) => c.author === "agent"),
    );

    const checks = [
      {
        name: "Database connection issue (issue-8) closed",
        passed: issue8?.status === "closed",
        detail: `status: ${issue8?.status}`,
      },
      {
        name: "Commented on a closed upgrade issue",
        passed: upgradeCommented,
        detail: whichUpgrade
          ? `commented on ${whichUpgrade}`
          : "no agent comment on any closed upgrade issue",
      },
      {
        name: "Kubernetes issue (issue-14) assigned to charlie",
        passed: issue14?.assignee === "charlie",
        detail: `assignee: ${issue14?.assignee}`,
      },
      {
        name: "issue-6 (rate limiting) has 'p0-critical' label",
        passed: issue6?.labels.includes("p0-critical") ?? false,
        detail: `labels: ${issue6?.labels.join(", ")}`,
      },
      {
        // The agent should find at most one rate limiting issue
        // and either report it can't find a second, or find a loosely related one
        // We don't fail on this — just track what the agent did
        name: "Agent attempted to handle 'two rate limiting issues'",
        passed: true, // informational — always passes
        detail: `issue-6 labeled: ${issue6?.labels.includes("p0-critical")}`,
      },
    ];

    return { passed: checks.every((c) => c.passed), checks };
  },
};
