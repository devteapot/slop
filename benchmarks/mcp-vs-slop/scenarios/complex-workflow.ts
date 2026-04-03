import type { Scenario, VerificationResult } from "./types";
import type { IssueTrackerStore } from "../app/store";

/**
 * Scenario: A realistic, multi-step user request that requires understanding
 * state, relationships, aggregates, and sequential reasoning.
 *
 * "I'm preparing for a sprint planning meeting. I need you to:
 *  1. Find the repo with the most open unassigned bugs
 *  2. In that repo, pick the 2 highest-priority bugs (security > bug)
 *  3. Assign them both to whoever already has the fewest assignments across all repos
 *  4. For each one, read the comments to understand the issue, then add a comment
 *     from 'agent' summarizing the problem and proposed next steps
 *  5. Add the 'sprint-candidate' label to both
 *  6. Finally, close any wontfix issues in that same repo to clean up the backlog"
 *
 * This exercises:
 * - Aggregate reasoning (which repo has most bugs, who has fewest assignments)
 * - Priority comparison (security > bug label ranking)
 * - Cross-entity correlation (assignee load across all repos)
 * - Comment reading and synthesis (understanding context before acting)
 * - State changes mid-workflow (closing wontfix changes affordances)
 * - Multi-step sequential logic (each step depends on previous results)
 *
 * SLOP advantage: The full tree gives the agent all the data to reason about
 * aggregates, priorities, and assignee load without any discovery calls.
 * Comments are visible (naive) or queryable (optimized). Affordances guide
 * valid actions at each step.
 *
 * MCP disadvantage: The agent must call list_repos, then list_issues per repo
 * to count bugs, then get_issue to read details, then list_comments for each,
 * then finally act. Many discovery round trips before it can even start planning.
 */
export const complexWorkflow: Scenario = {
  name: "complex-workflow",
  description: "Sprint planning: find busiest repo, pick top bugs, assign to least-loaded person, summarize, label, clean up",
  agentPrompt:
    "I'm preparing for sprint planning. Help me with the following:\n\n" +
    "1. Find which repository has the most open, unassigned bugs (issues with the 'bug' label that have no assignee).\n" +
    "2. In that repo, identify the 2 most critical unassigned bugs. Prioritize issues that also have the 'security' label over plain bugs.\n" +
    "3. Figure out who has the fewest assigned issues across ALL repos (considering currently assigned open issues only). Assign both bugs to that person.\n" +
    '4. For each of the 2 bugs, read their comments to understand the context, then add a comment from "agent" that briefly summarizes the problem and suggests a next step.\n' +
    "5. Add the 'sprint-candidate' label to both bugs.\n" +
    "6. Finally, close any open issues with the 'wontfix' label in that same repo to clean up the backlog.\n\n" +
    "Work through this systematically. Show your reasoning.",

  steps: [
    {
      name: "complex_workflow",
      async slop() {},
      async mcp() {},
    },
  ],

  verify(store: IssueTrackerStore): VerificationResult {
    // Step 1: Which repo has the most open unassigned bugs?
    // frontend: issue-1 (bug, unassigned), issue-3 (bug+security, unassigned) = 2
    // backend: issue-6 (bug+security, unassigned), issue-8 (bug, unassigned) = 2
    // infra: issue-11 (bug, unassigned), issue-13 (bug, unassigned) = 2
    // It's a three-way tie! The agent should pick one consistently.
    // Let's accept any repo that had 2 unassigned bugs.

    // Step 3: Who has fewest assignments?
    // Before any changes: alice has 1 (issue-4 closed), bob has 2 (issue-2, issue-12),
    // charlie has 1 (issue-7, issue-14 closed). But we only count open:
    // alice: 0 open assigned, bob: 2 open (issue-2, issue-12), charlie: 1 open (issue-7)
    // So alice has the fewest → should be assigned.

    // Find which issues got the sprint-candidate label
    const sprintCandidates = store.issues.filter((i) =>
      i.labels.includes("sprint-candidate"),
    );

    // Find which repo the agent chose (the one with sprint-candidate issues)
    const chosenRepoId = sprintCandidates.length > 0 ? sprintCandidates[0].repoId : null;

    // Expected: 2 issues got sprint-candidate
    const checks = [
      {
        name: "Exactly 2 issues labeled 'sprint-candidate'",
        passed: sprintCandidates.length === 2,
        detail: `found: ${sprintCandidates.length} (${sprintCandidates.map((i) => i.id).join(", ")})`,
      },
      {
        name: "Both sprint candidates are from the same repo",
        passed:
          sprintCandidates.length === 2 &&
          sprintCandidates[0].repoId === sprintCandidates[1].repoId,
        detail: sprintCandidates.map((i) => `${i.id}@${i.repoId}`).join(", "),
      },
      {
        name: "Sprint candidates were unassigned bugs",
        passed: sprintCandidates.every((i) => i.labels.includes("bug")),
        detail: sprintCandidates.map((i) => `${i.id}: ${i.labels.join(",")}`).join("; "),
      },
    ];

    // If there's a security+bug issue in the chosen repo, it should be one of the candidates
    if (chosenRepoId) {
      const securityBugs = store.issues.filter(
        (i) =>
          i.repoId === chosenRepoId &&
          i.labels.includes("bug") &&
          i.labels.includes("security"),
      );
      if (securityBugs.length > 0) {
        checks.push({
          name: "Security+bug issue prioritized as sprint candidate",
          passed: sprintCandidates.some((c) => c.labels.includes("security")),
          detail: `security bugs in ${chosenRepoId}: ${securityBugs.map((i) => i.id).join(", ")}`,
        });
      }
    }

    // Both should be assigned to the same person (least-loaded)
    checks.push({
      name: "Both candidates assigned to same person",
      passed:
        sprintCandidates.length === 2 &&
        sprintCandidates[0].assignee !== null &&
        sprintCandidates[0].assignee === sprintCandidates[1].assignee,
      detail: sprintCandidates.map((i) => `${i.id}: ${i.assignee}`).join(", "),
    });

    // The assignee should be the least-loaded person (alice has 0 open assignments)
    checks.push({
      name: "Assigned to least-loaded person (alice)",
      passed: sprintCandidates.every((i) => i.assignee === "alice"),
      detail: `assignees: ${sprintCandidates.map((i) => i.assignee).join(", ")}`,
    });

    // Comments should be added to both sprint candidates
    for (const candidate of sprintCandidates) {
      const comments = store.listComments(candidate.id);
      const agentComment = comments.find((c) => c.author === "agent");
      checks.push({
        name: `${candidate.id} has agent comment`,
        passed: agentComment !== undefined,
        detail: agentComment
          ? `"${agentComment.body.slice(0, 50)}..."`
          : "no agent comment",
      });
    }

    // Wontfix issues in the chosen repo should be closed
    if (chosenRepoId) {
      const wontfixInRepo = store.issues.filter(
        (i) => i.repoId === chosenRepoId && i.labels.includes("wontfix"),
      );
      for (const wf of wontfixInRepo) {
        checks.push({
          name: `${wf.id} (wontfix in ${chosenRepoId}) closed`,
          passed: wf.status === "closed",
          detail: `status: ${wf.status}`,
        });
      }
    }

    return { passed: checks.every((c) => c.passed), checks };
  },
};
