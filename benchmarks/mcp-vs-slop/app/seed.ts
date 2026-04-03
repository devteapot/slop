import type { Repo, Issue, Comment, Label } from "./store";

export const seedRepos: Repo[] = [
  { id: "frontend", name: "frontend", description: "React web application", visibility: "public" },
  { id: "backend", name: "backend", description: "Node.js API server", visibility: "public" },
  { id: "infra", name: "infra", description: "Infrastructure and deployment configs", visibility: "private" },
];

export const seedLabels: Label[] = [
  { id: "l-1", repoId: "frontend", name: "bug", color: "#d73a4a" },
  { id: "l-2", repoId: "frontend", name: "feature", color: "#0075ca" },
  { id: "l-3", repoId: "frontend", name: "in-progress", color: "#e4e669" },
  { id: "l-4", repoId: "frontend", name: "wontfix", color: "#ffffff" },
  { id: "l-5", repoId: "backend", name: "bug", color: "#d73a4a" },
  { id: "l-6", repoId: "backend", name: "feature", color: "#0075ca" },
  { id: "l-7", repoId: "backend", name: "security", color: "#e11d48" },
  { id: "l-8", repoId: "backend", name: "wontfix", color: "#ffffff" },
  { id: "l-9", repoId: "infra", name: "bug", color: "#d73a4a" },
  { id: "l-10", repoId: "infra", name: "enhancement", color: "#a2eeef" },
  { id: "l-11", repoId: "infra", name: "wontfix", color: "#ffffff" },
];

export const seedIssues: Issue[] = [
  // Frontend issues
  { id: "issue-1", repoId: "frontend", title: "Login form not validating email format", body: "The login form accepts invalid email addresses. Need to add proper validation.", status: "open", labels: ["bug"], assignee: null, createdAt: "2026-03-15T10:00:00Z" },
  { id: "issue-2", repoId: "frontend", title: "Add dark mode support", body: "Users have requested a dark mode toggle in the settings page.", status: "open", labels: ["feature"], assignee: "bob", createdAt: "2026-03-16T14:00:00Z" },
  { id: "issue-3", repoId: "frontend", title: "Fix authentication token refresh", body: "The auth token refresh flow is broken, users get logged out after 30 minutes.", status: "open", labels: ["bug", "security"], assignee: null, createdAt: "2026-03-18T09:00:00Z" },
  { id: "issue-4", repoId: "frontend", title: "Update React to v19", body: "Upgrade from React 18 to React 19 for improved performance.", status: "closed", labels: ["feature"], assignee: "alice", createdAt: "2026-03-10T11:00:00Z" },
  { id: "issue-5", repoId: "frontend", title: "Remove deprecated API calls", body: "Clean up deprecated v1 API calls that were replaced in the backend migration.", status: "open", labels: ["wontfix"], assignee: null, createdAt: "2026-03-20T08:00:00Z" },

  // Backend issues
  { id: "issue-6", repoId: "backend", title: "Rate limiting not working on /api/search", body: "The rate limiter middleware is not being applied to the search endpoint.", status: "open", labels: ["bug", "security"], assignee: null, createdAt: "2026-03-14T16:00:00Z" },
  { id: "issue-7", repoId: "backend", title: "Add pagination to list endpoints", body: "All list endpoints return unbounded results. Add cursor-based pagination.", status: "open", labels: ["feature"], assignee: "charlie", createdAt: "2026-03-17T13:00:00Z" },
  { id: "issue-8", repoId: "backend", title: "Database connection pool exhaustion", body: "Under high load, the connection pool runs out. Need to tune pool settings.", status: "open", labels: ["bug"], assignee: null, createdAt: "2026-03-19T07:00:00Z" },
  { id: "issue-9", repoId: "backend", title: "Migrate to PostgreSQL 16", body: "Upgrade from PG 15 to PG 16 for improved query planning.", status: "closed", labels: ["feature"], assignee: "alice", createdAt: "2026-03-08T10:00:00Z" },
  { id: "issue-10", repoId: "backend", title: "Legacy webhook format support", body: "Some consumers still use the v1 webhook format. Keep it or drop it?", status: "open", labels: ["wontfix"], assignee: null, createdAt: "2026-03-21T15:00:00Z" },

  // Infra issues
  { id: "issue-11", repoId: "infra", title: "CI pipeline times out on large PRs", body: "PRs with more than 50 changed files cause the CI to timeout at 30 minutes.", status: "open", labels: ["bug"], assignee: null, createdAt: "2026-03-13T12:00:00Z" },
  { id: "issue-12", repoId: "infra", title: "Add staging environment auto-deploy", body: "Set up automatic deployment to staging on merge to main.", status: "open", labels: ["enhancement"], assignee: "bob", createdAt: "2026-03-16T09:00:00Z" },
  { id: "issue-13", repoId: "infra", title: "Terraform state lock contention", body: "Multiple devs running terraform plan causes state lock conflicts.", status: "open", labels: ["bug"], assignee: null, createdAt: "2026-03-22T11:00:00Z" },
  { id: "issue-14", repoId: "infra", title: "Upgrade Kubernetes to 1.29", body: "Current cluster is on 1.27, need to upgrade for security patches.", status: "closed", labels: ["enhancement"], assignee: "charlie", createdAt: "2026-03-05T08:00:00Z" },
  { id: "issue-15", repoId: "infra", title: "Old monitoring dashboard removal", body: "The Grafana v8 dashboards are unused since we migrated. Remove them.", status: "open", labels: ["wontfix"], assignee: null, createdAt: "2026-03-23T14:00:00Z" },
];

export const seedComments: Comment[] = [
  // Comments on issue-1
  { id: "comment-1", issueId: "issue-1", author: "alice", body: "I can reproduce this. The regex is missing the TLD check.", createdAt: "2026-03-15T11:00:00Z" },
  { id: "comment-2", issueId: "issue-1", author: "bob", body: "Should we use a library like zod for this?", createdAt: "2026-03-15T12:00:00Z" },

  // Comments on issue-3
  { id: "comment-3", issueId: "issue-3", author: "charlie", body: "This is critical — affects all users. The refresh endpoint returns 401 instead of issuing a new token.", createdAt: "2026-03-18T10:00:00Z" },
  { id: "comment-4", issueId: "issue-3", author: "alice", body: "I think the issue is in the middleware. The token expiry check is using UTC but the token was issued with local time.", createdAt: "2026-03-18T14:00:00Z" },

  // Comments on issue-6
  { id: "comment-5", issueId: "issue-6", author: "bob", body: "The middleware is applied but the search endpoint is mounted before the rate limiter.", createdAt: "2026-03-14T17:00:00Z" },

  // Comments on issue-7
  { id: "comment-6", issueId: "issue-7", author: "alice", body: "Let's use cursor-based pagination, not offset-based. Better for large datasets.", createdAt: "2026-03-17T14:00:00Z" },
  { id: "comment-7", issueId: "issue-7", author: "charlie", body: "Agreed. I'll base it on the created_at timestamp + id for stable cursors.", createdAt: "2026-03-17T15:00:00Z" },

  // Comments on issue-8
  { id: "comment-8", issueId: "issue-8", author: "alice", body: "Default pool size is 10. We should increase to 25 and add connection timeout.", createdAt: "2026-03-19T08:00:00Z" },

  // Comments on issue-11
  { id: "comment-9", issueId: "issue-11", author: "charlie", body: "We could split the test suite into parallel jobs.", createdAt: "2026-03-13T13:00:00Z" },
  { id: "comment-10", issueId: "issue-11", author: "bob", body: "Or increase the timeout to 60 minutes? The large PRs are rare.", createdAt: "2026-03-13T14:00:00Z" },

  // Comments on issue-12
  { id: "comment-11", issueId: "issue-12", author: "alice", body: "We should add a manual approval step before staging deploys.", createdAt: "2026-03-16T10:00:00Z" },

  // Comments on issue-13
  { id: "comment-12", issueId: "issue-13", author: "bob", body: "Terraform Cloud would solve this with remote state management.", createdAt: "2026-03-22T12:00:00Z" },
  { id: "comment-13", issueId: "issue-13", author: "charlie", body: "Or we could use a simple locking mechanism with DynamoDB.", createdAt: "2026-03-22T13:00:00Z" },
];

export function createSeedData() {
  return {
    repos: seedRepos,
    issues: seedIssues,
    comments: seedComments,
    labels: seedLabels,
  };
}

/**
 * Generate a larger dataset: 10 repos, ~100 issues, ~200 comments.
 * Deterministic — same output every time.
 */
export function createLargeSeedData() {
  const repoNames = [
    "frontend", "backend", "infra", "mobile-ios", "mobile-android",
    "docs", "analytics", "auth-service", "payments", "notifications",
  ];
  const labelNames = ["bug", "feature", "enhancement", "security", "wontfix", "needs-review", "good-first-issue"];
  const authors = ["alice", "bob", "charlie", "diana", "evan", "fiona"];
  const statuses: ("open" | "closed")[] = ["open", "open", "open", "closed"]; // 75% open

  const issueTitles = [
    "Fix broken redirect after login", "Add support for dark mode", "Memory leak in worker pool",
    "Update dependency to latest major", "Flaky test in CI pipeline", "Add rate limiting to API",
    "Improve error messages for users", "Migrate to new auth provider", "Fix timezone handling in scheduler",
    "Add bulk export functionality", "Refactor database query layer", "Broken pagination on mobile",
    "Add webhook retry logic", "Remove deprecated endpoints", "Fix race condition in cache",
    "Add multi-language support", "Improve startup performance", "Fix CSS layout on Safari",
    "Add health check endpoint", "Upgrade Kubernetes manifests",
  ];

  const commentBodies = [
    "I can reproduce this on the latest build.",
    "This might be related to the recent migration.",
    "Let me take a look at this today.",
    "We should add a regression test for this.",
    "Fixed in my local branch, PR incoming.",
    "Can we prioritize this for the next sprint?",
    "The root cause is in the middleware layer.",
    "I think we need to rethink this approach.",
    "This has been an issue since v2.3.",
    "Marking as blocked until the dependency is updated.",
  ];

  const repos: Repo[] = repoNames.map((name) => ({
    id: name,
    name,
    description: `The ${name} service`,
    visibility: name === "infra" || name === "payments" ? "private" as const : "public" as const,
  }));

  const labels: Label[] = [];
  let labelId = 1;
  for (const repo of repos) {
    for (const label of labelNames) {
      labels.push({ id: `l-${labelId++}`, repoId: repo.id, name: label, color: "#888" });
    }
  }

  const issues: Issue[] = [];
  let issueId = 1;
  // Deterministic pseudo-random using simple seed
  let rng = 42;
  const rand = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; };

  for (const repo of repos) {
    const count = 8 + Math.floor(rand() * 5); // 8-12 issues per repo
    for (let i = 0; i < count; i++) {
      const titleIdx = Math.floor(rand() * issueTitles.length);
      const status = statuses[Math.floor(rand() * statuses.length)];
      // ~30% of issues are bugs, rest get a random label
      const issueLabels: string[] = [];
      if (rand() < 0.3) {
        issueLabels.push("bug");
      } else {
        issueLabels.push(labelNames[1 + Math.floor(rand() * (labelNames.length - 1))]);
      }
      // Occasionally add a second label
      if (rand() < 0.3) {
        const extra = labelNames[Math.floor(rand() * labelNames.length)];
        if (!issueLabels.includes(extra)) issueLabels.push(extra);
      }
      const hasAssignee = rand() > 0.5; // 50% unassigned
      issues.push({
        id: `issue-${issueId++}`,
        repoId: repo.id,
        title: `[${repo.name}] ${issueTitles[titleIdx]}`,
        body: `This issue affects the ${repo.name} service. ${issueTitles[titleIdx].toLowerCase()}.`,
        status,
        labels: issueLabels,
        assignee: hasAssignee ? authors[Math.floor(rand() * authors.length)] : null,
        createdAt: `2026-03-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}T${String(8 + Math.floor(rand() * 12)).padStart(2, "0")}:00:00Z`,
      });
    }
  }

  const comments: Comment[] = [];
  let commentId = 1;
  for (const issue of issues) {
    const count = Math.floor(rand() * 4); // 0-3 comments per issue
    for (let i = 0; i < count; i++) {
      comments.push({
        id: `comment-${commentId++}`,
        issueId: issue.id,
        author: authors[Math.floor(rand() * authors.length)],
        body: commentBodies[Math.floor(rand() * commentBodies.length)],
        createdAt: issue.createdAt,
      });
    }
  }

  return { repos, issues, comments, labels };
}
