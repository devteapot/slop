import type { Scenario, VerificationResult } from "./types";
import type { IssueTrackerStore } from "../app/store";

/**
 * Scenario: Close all issues labeled 'wontfix' across all repos.
 *
 * SLOP advantage: Subscribe gives the full tree. The agent can identify
 * all wontfix issues in one pass, then close them with targeted invokes.
 *
 * MCP disadvantage: Must list repos, query each repo for issues with wontfix label,
 * then close each one individually.
 */
export const bulkUpdate: Scenario = {
  name: "bulk-update",
  description: 'Close all issues labeled "wontfix" across all repos',
  agentPrompt:
    'Find all open issues that have the "wontfix" label across all repositories and close them.',

  steps: [
    {
      name: "find_wontfix_issues",
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
              (props.labels as string[])?.includes("wontfix")
            ) {
              _targets.push(issue.id);
            }
          }
        }
        // targets: issue-5, issue-10, issue-15
      },
      async mcp(client) {
        await client.callTool({ name: "list_repos", arguments: {} });
        await client.callTool({ name: "list_issues", arguments: { repo_id: "frontend", label: "wontfix" } });
        await client.callTool({ name: "list_issues", arguments: { repo_id: "backend", label: "wontfix" } });
        await client.callTool({ name: "list_issues", arguments: { repo_id: "infra", label: "wontfix" } });
      },
    },
    {
      name: "close_issue_5",
      async slop(consumer) {
        await consumer.invoke("/repos/frontend/issues/issue-5", "close", {});
      },
      async mcp(client) {
        await client.callTool({ name: "close_issue", arguments: { issue_id: "issue-5" } });
      },
    },
    {
      name: "close_issue_10",
      async slop(consumer) {
        await consumer.invoke("/repos/backend/issues/issue-10", "close", {});
      },
      async mcp(client) {
        await client.callTool({ name: "close_issue", arguments: { issue_id: "issue-10" } });
      },
    },
    {
      name: "close_issue_15",
      async slop(consumer) {
        await consumer.invoke("/repos/infra/issues/issue-15", "close", {});
      },
      async mcp(client) {
        await client.callTool({ name: "close_issue", arguments: { issue_id: "issue-15" } });
      },
    },
  ],

  verify(store: IssueTrackerStore): VerificationResult {
    const expectedClosed = ["issue-5", "issue-10", "issue-15"];
    const checks = expectedClosed.map((id) => {
      const issue = store.getIssue(id);
      return {
        name: `${id} closed`,
        passed: issue?.status === "closed",
        detail: `status: ${issue?.status ?? "not found"}`,
      };
    });

    // Verify no false positives — non-wontfix issues should still be open
    for (const id of ["issue-1", "issue-6", "issue-11"]) {
      const issue = store.getIssue(id);
      checks.push({
        name: `${id} still open (no wontfix label)`,
        passed: issue?.status === "open",
        detail: `status: ${issue?.status ?? "not found"}`,
      });
    }

    return { passed: checks.every((c) => c.passed), checks };
  },
};
