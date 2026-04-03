import type { Scenario, VerificationResult } from "./types";
import type { IssueTrackerStore } from "../app/store";

/**
 * Scenario: Find an issue about authentication, comment on it, and add a label.
 *
 * SLOP advantage: The subscribe gives the full state tree. The agent can see
 * all issues, their titles, statuses, and labels in one shot. No discovery calls needed.
 *
 * MCP disadvantage: The agent must call list_repos, then list_issues, then get_issue
 * to find the right issue before it can act on it.
 */
export const exploreAndAct: Scenario = {
  name: "explore-and-act",
  description:
    "Find the open issue about authentication in the frontend repo, add a comment, and add the 'in-progress' label",
  agentPrompt:
    'Find the open issue about authentication token refresh in the frontend repo. Add a comment from "agent" saying "I\'m investigating the token refresh issue - it looks like a timezone mismatch in the expiry check." Then add the "in-progress" label to it.',

  steps: [
    {
      name: "find_auth_issue",
      async slop(_consumer, _subId, snapshot) {
        // With SLOP, the issue is already in the snapshot tree — no extra call needed.
        // The agent just needs to scan the tree it already has.
        // We simulate "reading" the tree to find issue-3 (auth token refresh).
        const repos = snapshot.children ?? [];
        for (const repo of repos) {
          const issuesNode = repo.children?.find((c) => c.type === "collection");
          if (!issuesNode) continue;
          const items = issuesNode.children ?? [];
          for (const issue of items) {
            if (
              issue.properties?.title &&
              (issue.properties.title as string).toLowerCase().includes("authentication")
            ) {
              // Found it — no network call needed
              return;
            }
          }
        }
      },
      async mcp(client) {
        // MCP: must list repos first
        await client.callTool({ name: "list_repos", arguments: {} });
        // Then list issues in frontend
        await client.callTool({
          name: "list_issues",
          arguments: { repo_id: "frontend", status: "open" },
        });
        // Then get the specific issue to read details
        await client.callTool({
          name: "get_issue",
          arguments: { issue_id: "issue-3" },
        });
      },
    },
    {
      name: "add_comment",
      async slop(consumer) {
        await consumer.invoke("/repos/frontend/issues/issue-3", "comment", {
          author: "agent",
          body: "I'm investigating the token refresh issue - it looks like a timezone mismatch in the expiry check.",
        });
      },
      async mcp(client) {
        await client.callTool({
          name: "add_comment",
          arguments: {
            issue_id: "issue-3",
            author: "agent",
            body: "I'm investigating the token refresh issue - it looks like a timezone mismatch in the expiry check.",
          },
        });
      },
    },
    {
      name: "add_label",
      async slop(consumer) {
        await consumer.invoke("/repos/frontend/issues/issue-3", "add_label", {
          label: "in-progress",
        });
      },
      async mcp(client) {
        await client.callTool({
          name: "add_label",
          arguments: { issue_id: "issue-3", label: "in-progress" },
        });
      },
    },
  ],

  verify(store: IssueTrackerStore): VerificationResult {
    const issue = store.getIssue("issue-3");
    const comments = store.listComments("issue-3");
    const agentComment = comments.find((c) => c.author === "agent");

    const checks = [
      {
        name: "Found correct issue (issue-3)",
        passed: issue !== undefined,
      },
      {
        name: "Added comment from 'agent'",
        passed: agentComment !== undefined,
        detail: agentComment ? `Comment: "${agentComment.body.slice(0, 60)}..."` : "No comment from agent found",
      },
      {
        name: "Added 'in-progress' label",
        passed: issue?.labels.includes("in-progress") ?? false,
        detail: `Labels: ${issue?.labels.join(", ") ?? "none"}`,
      },
    ];

    return { passed: checks.every((c) => c.passed), checks };
  },
};
