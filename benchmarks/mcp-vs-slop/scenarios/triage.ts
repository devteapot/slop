import type { Scenario, VerificationResult } from "./types";
import type { IssueTrackerStore } from "../app/store";

/**
 * Scenario: Triage all open unassigned bugs across all repos.
 *
 * SLOP advantage: One subscribe gives the full tree with all issues, their status,
 * labels, and assignees. The agent can immediately identify which issues need action
 * without any discovery calls.
 *
 * MCP disadvantage: Must list repos, then list issues per repo, potentially get
 * individual issues to see assignee details — many round trips before acting.
 */
export const triage: Scenario = {
  name: "triage",
  description:
    "Find all open, unassigned bug issues across all repos and assign them to 'alice' with 'needs-review' label",
  agentPrompt:
    'Review all open issues across all repos. For any unassigned issue that has the "bug" label, assign it to "alice" and add the "needs-review" label.',

  steps: [
    {
      name: "discover_unassigned_bugs",
      async slop(_consumer, _subId, snapshot) {
        const repos = snapshot.children ?? [];
        const _targets: string[] = [];
        for (const repo of repos) {
          const issuesNode = repo.children?.find((c) => c.type === "collection");
          if (!issuesNode) continue;
          for (const issue of issuesNode.children ?? []) {
            const props = issue.properties ?? {};
            if (
              props.status === "open" &&
              !props.assignee &&
              (props.labels as string[])?.includes("bug")
            ) {
              _targets.push(issue.id);
            }
          }
        }
        // targets: issue-1, issue-8, issue-11, issue-13
      },
      async mcp(client) {
        await client.callTool({ name: "list_repos", arguments: {} });
        await client.callTool({ name: "list_issues", arguments: { repo_id: "frontend", status: "open" } });
        await client.callTool({ name: "list_issues", arguments: { repo_id: "backend", status: "open" } });
        await client.callTool({ name: "list_issues", arguments: { repo_id: "infra", status: "open" } });
      },
    },
    {
      name: "assign_issue_1",
      async slop(consumer) {
        await consumer.invoke("/repos/frontend/issues/issue-1", "assign", { assignee: "alice" });
      },
      async mcp(client) {
        await client.callTool({ name: "assign_issue", arguments: { issue_id: "issue-1", assignee: "alice" } });
      },
    },
    {
      name: "label_issue_1",
      async slop(consumer) {
        await consumer.invoke("/repos/frontend/issues/issue-1", "add_label", { label: "needs-review" });
      },
      async mcp(client) {
        await client.callTool({ name: "add_label", arguments: { issue_id: "issue-1", label: "needs-review" } });
      },
    },
    {
      name: "assign_issue_8",
      async slop(consumer) {
        await consumer.invoke("/repos/backend/issues/issue-8", "assign", { assignee: "alice" });
      },
      async mcp(client) {
        await client.callTool({ name: "assign_issue", arguments: { issue_id: "issue-8", assignee: "alice" } });
      },
    },
    {
      name: "label_issue_8",
      async slop(consumer) {
        await consumer.invoke("/repos/backend/issues/issue-8", "add_label", { label: "needs-review" });
      },
      async mcp(client) {
        await client.callTool({ name: "add_label", arguments: { issue_id: "issue-8", label: "needs-review" } });
      },
    },
    {
      name: "assign_issue_11",
      async slop(consumer) {
        await consumer.invoke("/repos/infra/issues/issue-11", "assign", { assignee: "alice" });
      },
      async mcp(client) {
        await client.callTool({ name: "assign_issue", arguments: { issue_id: "issue-11", assignee: "alice" } });
      },
    },
    {
      name: "label_issue_11",
      async slop(consumer) {
        await consumer.invoke("/repos/infra/issues/issue-11", "add_label", { label: "needs-review" });
      },
      async mcp(client) {
        await client.callTool({ name: "add_label", arguments: { issue_id: "issue-11", label: "needs-review" } });
      },
    },
    {
      name: "assign_issue_13",
      async slop(consumer) {
        await consumer.invoke("/repos/infra/issues/issue-13", "assign", { assignee: "alice" });
      },
      async mcp(client) {
        await client.callTool({ name: "assign_issue", arguments: { issue_id: "issue-13", assignee: "alice" } });
      },
    },
    {
      name: "label_issue_13",
      async slop(consumer) {
        await consumer.invoke("/repos/infra/issues/issue-13", "add_label", { label: "needs-review" });
      },
      async mcp(client) {
        await client.callTool({ name: "add_label", arguments: { issue_id: "issue-13", label: "needs-review" } });
      },
    },
  ],

  verify(store: IssueTrackerStore): VerificationResult {
    // Expected: issue-1, issue-8, issue-11, issue-13 should all be assigned to alice with needs-review
    const expectedIds = ["issue-1", "issue-8", "issue-11", "issue-13"];
    const checks = expectedIds.flatMap((id) => {
      const issue = store.getIssue(id);
      return [
        {
          name: `${id} assigned to alice`,
          passed: issue?.assignee === "alice",
          detail: `assignee: ${issue?.assignee ?? "null"}`,
        },
        {
          name: `${id} has 'needs-review' label`,
          passed: issue?.labels.includes("needs-review") ?? false,
          detail: `labels: ${issue?.labels.join(", ") ?? "none"}`,
        },
      ];
    });

    // Also verify no false positives — issues that had bugs but were already assigned should NOT be changed
    // issue-3 has bug+security labels but is unassigned, so it SHOULD be triaged
    const issue3 = store.getIssue("issue-3");
    checks.push({
      name: "issue-3 (bug+security, unassigned) also triaged",
      passed: issue3?.assignee === "alice" && issue3?.labels.includes("needs-review"),
      detail: `assignee: ${issue3?.assignee ?? "null"}, labels: ${issue3?.labels.join(", ")}`,
    });

    return { passed: checks.every((c) => c.passed), checks };
  },
};
