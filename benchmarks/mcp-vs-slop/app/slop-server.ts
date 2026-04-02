import { SlopServer } from "@slop-ai/server";
import { bunHandler } from "@slop-ai/server/bun";
import type { IssueTrackerStore, Issue } from "./store";

export interface SlopServerOpts {
  maxNodes?: number;
  maxDepth?: number;
  /**
   * When true, applies production-grade optimizations:
   * - Windowed collections (open issues only in default window)
   * - Salience scoring (open unassigned bugs = high, closed = low)
   * - Lazy subtrees (comments not inlined, available via query)
   * - Rich summaries on collections
   */
  optimized?: boolean;
}

export function createSlopServer(store: IssueTrackerStore, opts?: SlopServerOpts) {
  const slop = new SlopServer({
    id: "issue-tracker",
    name: "Issue Tracker",
    ...(opts?.maxNodes != null && { maxNodes: opts.maxNodes }),
    ...(opts?.maxDepth != null && { maxDepth: opts.maxDepth }),
  });

  const optimized = opts?.optimized ?? false;

  // --- Root context ---
  slop.register("overview", () => {
    const openIssues = store.issues.filter((i) => i.status === "open");
    const closedCount = store.issues.length - openIssues.length;
    const unassigned = openIssues.filter((i) => !i.assignee).length;
    const bugs = openIssues.filter((i) => i.labels.includes("bug")).length;
    return {
      type: "context",
      props: {
        repos: store.repos.length,
        open_issues: openIssues.length,
        closed_issues: closedCount,
        total_issues: store.issues.length,
      },
      summary: `${store.repos.length} repos, ${openIssues.length} open issues (${unassigned} unassigned, ${bugs} bugs), ${closedCount} closed`,
    };
  });

  // --- Register each repo ---
  for (const repo of store.repos) {
    slop.register(`repos/${repo.id}`, () => {
      const repoIssues = store.issues.filter((i) => i.repoId === repo.id);
      const openCount = repoIssues.filter((i) => i.status === "open").length;

      return {
        type: "tracker:repo",
        props: {
          name: repo.name,
          description: repo.description,
          visibility: repo.visibility,
          open_issues: openCount,
          total_issues: repoIssues.length,
        },
        actions: {
          create_issue: {
            handler: async (params) => {
              const issue = store.createIssue(
                repo.id,
                params.title as string,
                params.body as string,
                params.labels ? (params.labels as string).split(",").map((s: string) => s.trim()) : undefined,
              );
              slop.refresh();
              return issue;
            },
            label: "Create issue",
            description: "Create a new issue in this repo",
            params: {
              title: { type: "string", description: "Issue title" },
              body: { type: "string", description: "Issue body" },
              labels: { type: "string", description: "Comma-separated labels" },
            },
            estimate: "instant" as const,
          },
          search: {
            handler: async (params) => {
              const q = (params.query as string).toLowerCase();
              const results = store
                .listIssues(repo.id)
                .filter(
                  (i) =>
                    i.title.toLowerCase().includes(q) ||
                    i.body.toLowerCase().includes(q) ||
                    i.labels.some((l) => l.toLowerCase().includes(q)),
                );
              return { results };
            },
            label: "Search issues",
            description: "Search issues in this repo",
            params: {
              query: { type: "string", description: "Search query" },
            },
            idempotent: true,
            estimate: "instant" as const,
          },
        },
      };
    });

    // --- Register issues under each repo ---
    slop.register(`repos/${repo.id}/issues`, () => {
      const repoIssues = store.listIssues(repo.id);

      if (optimized) {
        return buildOptimizedCollection(store, slop, repo.id, repoIssues);
      }

      // Naive: dump everything
      return {
        type: "collection",
        props: { count: repoIssues.length },
        items: repoIssues.map((issue) => buildIssueItem(store, slop, issue, false)),
      };
    });
  }

  return slop;
}

/**
 * Optimized collection: windowed to open issues, rich summary,
 * salience scoring, lazy comments.
 */
function buildOptimizedCollection(
  store: IssueTrackerStore,
  slop: SlopServer,
  repoId: string,
  allIssues: Issue[],
) {
  const openIssues = allIssues.filter((i) => i.status === "open");
  const closedCount = allIssues.length - openIssues.length;
  const unassigned = openIssues.filter((i) => !i.assignee).length;
  const bugs = openIssues.filter((i) => i.labels.includes("bug")).length;

  // Label distribution for summary
  const labelCounts = new Map<string, number>();
  for (const i of openIssues) {
    for (const l of i.labels) labelCounts.set(l, (labelCounts.get(l) ?? 0) + 1);
  }
  const labelSummary = [...labelCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([l, c]) => `${l}(${c})`)
    .join(", ");

  // ALL issues are registered as items so they exist in the tree and are
  // queryable. Salience scoring ensures closed/low-priority issues are
  // compacted first by maxNodes. Sorted by salience (most relevant first).
  const scored = allIssues.map((issue) => ({
    issue,
    salience: computeIssueSalience(issue),
  }));
  scored.sort((a, b) => b.salience - a.salience);

  return {
    type: "collection",
    props: { count: allIssues.length },
    summary: `${allIssues.length} issues: ${openIssues.length} open (${unassigned} unassigned, ${bugs} bugs), ${closedCount} closed. Labels: ${labelSummary}`,
    items: scored.map(({ issue, salience }) =>
      buildIssueItem(store, slop, issue, true, salience),
    ),
  };
}

/**
 * Compute salience for an issue. Higher = more relevant to an AI agent.
 */
function computeIssueSalience(issue: Issue): number {
  // Closed issues are low priority
  if (issue.status === "closed") return 0.1;

  let salience = 0.5; // base for open issues

  // Unassigned = needs attention
  if (!issue.assignee) salience += 0.2;

  // Bug label = higher priority
  if (issue.labels.includes("bug")) salience += 0.15;

  // Security label = critical
  if (issue.labels.includes("security")) salience += 0.15;

  // Wontfix = low priority even if open
  if (issue.labels.includes("wontfix")) salience -= 0.3;

  return Math.min(1.0, Math.max(0.0, salience));
}

function buildIssueItem(
  store: IssueTrackerStore,
  slop: SlopServer,
  issue: Issue,
  lazyComments: boolean,
  salience?: number,
) {
  const comments = store.listComments(issue.id);
  const actions: Record<string, any> = {};

  // Comment is always available (you can comment on closed issues)
  actions.comment = {
    handler: async (params: Record<string, unknown>) => {
      const comment = store.addComment(issue.id, params.author as string, params.body as string);
      slop.refresh();
      return comment;
    },
    label: "Add comment",
    params: {
      author: { type: "string", description: "Comment author" },
      body: { type: "string", description: "Comment text" },
    },
    estimate: "instant" as const,
  };

  // Contextual affordances based on issue status
  if (issue.status === "open") {
    actions.close = {
      handler: async () => {
        store.closeIssue(issue.id);
        slop.refresh();
        return { status: "closed" };
      },
      label: "Close issue",
      estimate: "instant" as const,
    };

    actions.assign = {
      handler: async (params: Record<string, unknown>) => {
        store.assignIssue(issue.id, params.assignee as string);
        slop.refresh();
        return { assignee: params.assignee };
      },
      label: "Assign issue",
      params: {
        assignee: { type: "string", description: "Username to assign" },
      },
      estimate: "instant" as const,
    };

    actions.add_label = {
      handler: async (params: Record<string, unknown>) => {
        store.addLabel(issue.id, params.label as string);
        slop.refresh();
        return { labels: store.getIssue(issue.id)?.labels };
      },
      label: "Add label",
      params: {
        label: { type: "string", description: "Label to add" },
      },
      estimate: "instant" as const,
    };

    actions.remove_label = {
      handler: async (params: Record<string, unknown>) => {
        store.removeLabel(issue.id, params.label as string);
        slop.refresh();
        return { labels: store.getIssue(issue.id)?.labels };
      },
      label: "Remove label",
      params: {
        label: { type: "string", description: "Label to remove" },
      },
      estimate: "instant" as const,
    };
  } else {
    // Closed issues can only be reopened
    actions.reopen = {
      handler: async () => {
        store.reopenIssue(issue.id);
        slop.refresh();
        return { status: "open" };
      },
      label: "Reopen issue",
      estimate: "instant" as const,
    };
  }

  // Build meta with salience if provided
  const meta: Record<string, unknown> = {};
  if (salience != null) meta.salience = salience;

  // Lazy comments: don't inline comment bodies, just declare they exist
  // The agent can query deeper to read them if needed
  if (lazyComments && comments.length > 0) {
    const authors = [...new Set(comments.map((c) => c.author))];
    meta.total_children = comments.length;
    meta.summary = `${comments.length} comment${comments.length === 1 ? "" : "s"} from ${authors.join(", ")}`;
  }

  const result: Record<string, any> = {
    id: issue.id,
    type: "tracker:issue",
    props: {
      title: issue.title,
      status: issue.status,
      labels: issue.labels,
      assignee: issue.assignee,
      created_at: issue.createdAt,
    },
    actions,
  };

  // Only include body in non-optimized mode — it's verbose and rarely needed for triage
  if (!lazyComments) {
    result.props.body = issue.body;
    result.props.comment_count = comments.length;
  }

  if (Object.keys(meta).length > 0) result.meta = meta;

  // Inline comments only in naive mode
  if (!lazyComments) {
    result.children = comments.map((c) => ({
      id: c.id,
      type: "tracker:comment",
      props: {
        author: c.author,
        body: c.body,
        created_at: c.createdAt,
      },
    }));
  }

  return result;
}

export function startSlopServer(store: IssueTrackerStore, port: number, opts?: SlopServerOpts) {
  const slop = createSlopServer(store, opts);
  const handler = bunHandler(slop, { path: "/slop" });

  const server = Bun.serve({
    port,
    fetch(req, server) {
      const resp = handler.fetch(req, server);
      if (resp) return resp;
      return new Response("SLOP Issue Tracker Benchmark Server", { status: 200 });
    },
    websocket: handler.websocket,
  });

  return { server, slop };
}
