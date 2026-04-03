import type { Scenario, VerificationResult } from "./types";
import type { IssueTrackerStore } from "../app/store";

/**
 * Scenario: Conditional actions based on state the agent observes.
 *
 * SLOP advantage: The full tree gives the agent all the data it needs to
 * evaluate conditions without additional queries. It can see comment counts,
 * labels, assignees, and status all at once.
 *
 * MCP disadvantage: Each condition check requires a tool call. "Does this
 * issue have comments?" needs list_comments. "Who is assigned?" needs
 * get_issue. The agent burns round trips on reads before it can decide.
 */
export const conditional: Scenario = {
  name: "conditional",
  description: "Perform different actions based on issue state (comments, labels, assignees)",
  agentPrompt:
    'Apply these rules to ALL open issues in the frontend repo:\n\n' +
    '1. If the issue has 2 or more comments, it\'s been discussed enough — add the "needs-review" label.\n' +
    '2. If the issue has 0 comments and no assignee, it\'s been neglected — assign it to "bob" and add a comment from "agent" saying "Assigning to bob for initial triage."\n' +
    '3. If the issue already has the "wontfix" label, skip it entirely — don\'t modify it.\n\n' +
    'Apply these rules to each open issue independently. Report what you did for each.',

  steps: [
    {
      name: "conditional_actions",
      async slop() {},
      async mcp() {},
    },
  ],

  verify(store: IssueTrackerStore): VerificationResult {
    // Frontend open issues from seed:
    // issue-1: "Login form validation" - bug, no assignee, 2 comments (alice, bob)
    // issue-2: "Dark mode" - feature, assignee: bob, 0 comments
    // issue-3: "Auth token refresh" - bug+security, no assignee, 2 comments (charlie, alice)
    // issue-5: "Remove deprecated API" - wontfix, no assignee, 0 comments

    const issue1 = store.getIssue("issue-1");
    const issue2 = store.getIssue("issue-2");
    const issue3 = store.getIssue("issue-3");
    const issue5 = store.getIssue("issue-5");

    const checks = [
      // Rule 1: issue-1 has 2 comments → needs-review
      {
        name: "issue-1 (2 comments) → 'needs-review' label",
        passed: issue1?.labels.includes("needs-review") ?? false,
        detail: `labels: ${issue1?.labels.join(", ")}`,
      },
      // Rule 1: issue-3 has 2 comments → needs-review
      {
        name: "issue-3 (2 comments) → 'needs-review' label",
        passed: issue3?.labels.includes("needs-review") ?? false,
        detail: `labels: ${issue3?.labels.join(", ")}`,
      },
      // Rule 2: issue-2 has 0 comments but HAS assignee (bob) → rule 2 doesn't apply
      // It also doesn't have 2+ comments, so rule 1 doesn't apply either
      // Should be untouched
      {
        name: "issue-2 (0 comments, has assignee) → unchanged",
        passed: issue2?.assignee === "bob" && !issue2?.labels.includes("needs-review"),
        detail: `assignee: ${issue2?.assignee}, labels: ${issue2?.labels.join(", ")}`,
      },
      // Rule 3: issue-5 has wontfix → skip entirely
      {
        name: "issue-5 (wontfix) → skipped, no changes",
        passed:
          issue5?.assignee === null &&
          !issue5?.labels.includes("needs-review") &&
          store.listComments("issue-5").filter((c) => c.author === "agent").length === 0,
        detail: `assignee: ${issue5?.assignee}, labels: ${issue5?.labels.join(", ")}`,
      },
      // Verify no inappropriate assignments — issue-1 and issue-3 have 2+ comments
      // so rule 2 (0 comments + no assignee) should NOT apply to them
      {
        name: "issue-1 not reassigned by rule 2 (has comments)",
        passed: issue1?.assignee !== "bob" || issue1?.assignee === null,
        detail: `assignee: ${issue1?.assignee}`,
      },
    ];

    return { passed: checks.every((c) => c.passed), checks };
  },
};
