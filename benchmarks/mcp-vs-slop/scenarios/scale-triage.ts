import type { Scenario, VerificationResult } from "./types";
import type { IssueTrackerStore } from "../app/store";
import { createLargeSeedData } from "../app/seed";

interface RepoSummary {
  id: string;
}

interface IssueSummary {
  id: string;
  assignee?: string | null;
  labels: string[];
}

/**
 * Scenario: Same triage task but against a 10-repo, ~100-issue dataset.
 *
 * This is where the scaling difference really shows:
 * - SLOP: one subscribe returns the full (or compacted) tree. Agent scans it once.
 * - MCP: must list 10 repos, then list issues for each (10 calls), then act.
 *
 * Uses the large seed data (set in the runner).
 */
export const scaleTriage: Scenario = {
  name: "scale-triage",
  description:
    'Triage unassigned bugs across 10 repos (~100 issues) — assign to "alice" with "needs-review"',
  largeDataset: true,
  agentPrompt:
    'Review all open issues across ALL repositories. For every unassigned issue that has the "bug" label, assign it to "alice" and add the "needs-review" label. Work through all repos systematically.',

  steps: [
    {
      name: "discover_unassigned_bugs",
      async slop(_consumer, _subId, snapshot) {
        // Full tree is in memory — scan all repos for unassigned bugs
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
      },
      async mcp(client) {
        // MCP: must list repos then query each one
        const result = await client.callTool({ name: "list_repos", arguments: {} });
        const repos = parseRepoSummaries(getToolText(result));
        for (const repo of repos) {
          await client.callTool({
            name: "list_issues",
            arguments: { repo_id: repo.id, status: "open" },
          });
        }
      },
    },
    {
      // We simulate acting on the first 5 found bugs (representative sample)
      name: "assign_and_label_batch",
      async slop(consumer, _subId, snapshot) {
        const targets: { repoId: string; issueId: string }[] = [];
        const repos = snapshot.children ?? [];
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
              // Find the repo id from the tree path
              targets.push({ repoId: repo.id, issueId: issue.id });
            }
          }
        }
        // Act on first 5
        for (const t of targets.slice(0, 5)) {
          await consumer.invoke(`/repos/${t.repoId}/issues/${t.issueId}`, "assign", { assignee: "alice" });
          await consumer.invoke(`/repos/${t.repoId}/issues/${t.issueId}`, "add_label", { label: "needs-review" });
        }
      },
      async mcp(client) {
        // MCP: the agent already listed issues above, now needs to find unassigned bugs
        // In practice, the agent would parse the list_issues results. We simulate finding 5 bugs.
        // First, re-list to get issue details (agent doesn't cache across steps)
        const repoResult = await client.callTool({ name: "list_repos", arguments: {} });
        const repos = parseRepoSummaries(getToolText(repoResult));

        let actedOn = 0;
        for (const repo of repos) {
          if (actedOn >= 5) break;
          const issueResult = await client.callTool({
            name: "list_issues",
            arguments: { repo_id: repo.id, status: "open" },
          });
          const issues = parseIssueSummaries(getToolText(issueResult));
          for (const issue of issues) {
            if (actedOn >= 5) break;
            if (!issue.assignee && issue.labels.includes("bug")) {
              await client.callTool({ name: "assign_issue", arguments: { issue_id: issue.id, assignee: "alice" } });
              await client.callTool({ name: "add_label", arguments: { issue_id: issue.id, label: "needs-review" } });
              actedOn++;
            }
          }
        }
      },
    },
  ],

  verify(store: IssueTrackerStore): VerificationResult {
    // Compare against original seed to know which issues were originally unassigned
    const originalSeed = createLargeSeedData();
    const originallyUnassignedBugs = originalSeed.issues.filter(
      (i) => i.status === "open" && !i.assignee && i.labels.includes("bug"),
    );
    const originallyAssignedBugs = originalSeed.issues.filter(
      (i) => i.status === "open" && i.assignee && i.labels.includes("bug"),
    );

    const checks = originallyUnassignedBugs.map((original) => {
      const current = store.getIssue(original.id);
      return {
        name: `${original.id} assigned to alice`,
        passed: current?.assignee === "alice",
        detail: `assignee: ${current?.assignee ?? "null"}`,
      };
    });

    // Also check needs-review label was added
    const withLabel = originallyUnassignedBugs.filter((original) => {
      const current = store.getIssue(original.id);
      return current?.labels.includes("needs-review");
    });
    checks.push({
      name: "needs-review label added to triaged issues",
      passed: withLabel.length === originallyUnassignedBugs.length,
      detail: `${withLabel.length}/${originallyUnassignedBugs.length} have needs-review`,
    });

    // Verify no false positives — already-assigned bugs should keep their original assignee
    for (const original of originallyAssignedBugs.slice(0, 3)) {
      const current = store.getIssue(original.id);
      checks.push({
        name: `${original.id} keeps original assignee (${original.assignee})`,
        passed: current?.assignee === original.assignee,
        detail: `was: ${original.assignee}, now: ${current?.assignee}`,
      });
    }

    return { passed: checks.every((c) => c.passed), checks };
  },
};

function getToolText(result: unknown): string {
  if (!isContentResult(result)) return "[]";
  const textBlock = result.content.find(isTextContentBlock);
  return textBlock?.text ?? "[]";
}

function parseRepoSummaries(text: string): RepoSummary[] {
  const data = safeParseJson(text);
  if (!Array.isArray(data)) return [];
  return data.filter(isRepoSummary);
}

function parseIssueSummaries(text: string): IssueSummary[] {
  const data = safeParseJson(text);
  if (!Array.isArray(data)) return [];
  return data.filter(isIssueSummary);
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn("[slop] failed to parse MCP benchmark payload:", error);
    return [];
  }
}

function isTextContentBlock(value: unknown): value is { type: "text"; text: string } {
  return !!value
    && typeof value === "object"
    && (value as { type?: unknown }).type === "text"
    && typeof (value as { text?: unknown }).text === "string";
}

function isContentResult(value: unknown): value is { content: unknown[] } {
  return !!value
    && typeof value === "object"
    && Array.isArray((value as { content?: unknown }).content);
}

function isRepoSummary(value: unknown): value is RepoSummary {
  return !!value
    && typeof value === "object"
    && typeof (value as { id?: unknown }).id === "string";
}

function isIssueSummary(value: unknown): value is IssueSummary {
  return !!value
    && typeof value === "object"
    && typeof (value as { id?: unknown }).id === "string"
    && Array.isArray((value as { labels?: unknown }).labels)
    && (value as { labels: unknown[] }).labels.every((label) => typeof label === "string")
    && (typeof (value as { assignee?: unknown }).assignee === "string"
      || typeof (value as { assignee?: unknown }).assignee === "undefined"
      || (value as { assignee?: unknown }).assignee === null);
}
