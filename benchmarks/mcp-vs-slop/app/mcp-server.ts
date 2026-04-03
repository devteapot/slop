import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { IssueTrackerStore } from "./store";
import { createSeedData, createLargeSeedData } from "./seed";

const store = new IssueTrackerStore();
store.reset(process.env.BENCH_LARGE_DATASET ? createLargeSeedData() : createSeedData());

const server = new Server(
  { name: "issue-tracker-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_repos",
      description: "List all repositories",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "get_repo",
      description: "Get details of a specific repository",
      inputSchema: {
        type: "object" as const,
        properties: { repo_id: { type: "string", description: "Repository ID" } },
        required: ["repo_id"],
      },
    },
    {
      name: "list_issues",
      description: "List issues in a repository, optionally filtered by status or label",
      inputSchema: {
        type: "object" as const,
        properties: {
          repo_id: { type: "string", description: "Repository ID" },
          status: { type: "string", enum: ["open", "closed"], description: "Filter by status" },
          label: { type: "string", description: "Filter by label" },
        },
        required: ["repo_id"],
      },
    },
    {
      name: "get_issue",
      description: "Get details of a specific issue including its comments",
      inputSchema: {
        type: "object" as const,
        properties: { issue_id: { type: "string", description: "Issue ID" } },
        required: ["issue_id"],
      },
    },
    {
      name: "create_issue",
      description: "Create a new issue in a repository",
      inputSchema: {
        type: "object" as const,
        properties: {
          repo_id: { type: "string", description: "Repository ID" },
          title: { type: "string", description: "Issue title" },
          body: { type: "string", description: "Issue body" },
          labels: { type: "string", description: "Comma-separated labels" },
        },
        required: ["repo_id", "title", "body"],
      },
    },
    {
      name: "close_issue",
      description: "Close an open issue",
      inputSchema: {
        type: "object" as const,
        properties: { issue_id: { type: "string", description: "Issue ID" } },
        required: ["issue_id"],
      },
    },
    {
      name: "reopen_issue",
      description: "Reopen a closed issue",
      inputSchema: {
        type: "object" as const,
        properties: { issue_id: { type: "string", description: "Issue ID" } },
        required: ["issue_id"],
      },
    },
    {
      name: "add_comment",
      description: "Add a comment to an issue",
      inputSchema: {
        type: "object" as const,
        properties: {
          issue_id: { type: "string", description: "Issue ID" },
          author: { type: "string", description: "Comment author" },
          body: { type: "string", description: "Comment text" },
        },
        required: ["issue_id", "author", "body"],
      },
    },
    {
      name: "list_comments",
      description: "List all comments on an issue",
      inputSchema: {
        type: "object" as const,
        properties: { issue_id: { type: "string", description: "Issue ID" } },
        required: ["issue_id"],
      },
    },
    {
      name: "add_label",
      description: "Add a label to an issue",
      inputSchema: {
        type: "object" as const,
        properties: {
          issue_id: { type: "string", description: "Issue ID" },
          label: { type: "string", description: "Label to add" },
        },
        required: ["issue_id", "label"],
      },
    },
    {
      name: "remove_label",
      description: "Remove a label from an issue",
      inputSchema: {
        type: "object" as const,
        properties: {
          issue_id: { type: "string", description: "Issue ID" },
          label: { type: "string", description: "Label to remove" },
        },
        required: ["issue_id", "label"],
      },
    },
    {
      name: "assign_issue",
      description: "Assign an issue to a user",
      inputSchema: {
        type: "object" as const,
        properties: {
          issue_id: { type: "string", description: "Issue ID" },
          assignee: { type: "string", description: "Username to assign" },
        },
        required: ["issue_id", "assignee"],
      },
    },
    {
      name: "search_issues",
      description: "Search issues across all repositories by title, body, or label",
      inputSchema: {
        type: "object" as const,
        properties: { query: { type: "string", description: "Search query" } },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, string>;

  switch (name) {
    case "list_repos":
      return { content: [{ type: "text", text: JSON.stringify(store.listRepos()) }] };

    case "get_repo": {
      const repo = store.getRepo(a.repo_id);
      if (!repo) return { content: [{ type: "text", text: `Repo "${a.repo_id}" not found` }], isError: true };
      const issues = store.listIssues(a.repo_id);
      const openCount = issues.filter((i) => i.status === "open").length;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ ...repo, open_issues: openCount, total_issues: issues.length }),
        }],
      };
    }

    case "list_issues": {
      const issues = store.listIssues(a.repo_id, {
        status: a.status as "open" | "closed" | undefined,
        label: a.label,
      });
      return { content: [{ type: "text", text: JSON.stringify(issues) }] };
    }

    case "get_issue": {
      const issue = store.getIssue(a.issue_id);
      if (!issue) return { content: [{ type: "text", text: `Issue "${a.issue_id}" not found` }], isError: true };
      const comments = store.listComments(a.issue_id);
      return { content: [{ type: "text", text: JSON.stringify({ ...issue, comments }) }] };
    }

    case "create_issue": {
      const labels = a.labels ? a.labels.split(",").map((s: string) => s.trim()) : undefined;
      const issue = store.createIssue(a.repo_id, a.title, a.body, labels);
      return { content: [{ type: "text", text: JSON.stringify(issue) }] };
    }

    case "close_issue": {
      const issue = store.closeIssue(a.issue_id);
      if (!issue) return { content: [{ type: "text", text: `Issue "${a.issue_id}" not found` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(issue) }] };
    }

    case "reopen_issue": {
      const issue = store.reopenIssue(a.issue_id);
      if (!issue) return { content: [{ type: "text", text: `Issue "${a.issue_id}" not found` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(issue) }] };
    }

    case "add_comment": {
      const comment = store.addComment(a.issue_id, a.author, a.body);
      return { content: [{ type: "text", text: JSON.stringify(comment) }] };
    }

    case "list_comments": {
      const comments = store.listComments(a.issue_id);
      return { content: [{ type: "text", text: JSON.stringify(comments) }] };
    }

    case "add_label": {
      const issue = store.addLabel(a.issue_id, a.label);
      if (!issue) return { content: [{ type: "text", text: `Issue "${a.issue_id}" not found` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify({ labels: issue.labels }) }] };
    }

    case "remove_label": {
      const issue = store.removeLabel(a.issue_id, a.label);
      if (!issue) return { content: [{ type: "text", text: `Issue "${a.issue_id}" not found` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify({ labels: issue.labels }) }] };
    }

    case "assign_issue": {
      const issue = store.assignIssue(a.issue_id, a.assignee);
      if (!issue) return { content: [{ type: "text", text: `Issue "${a.issue_id}" not found` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify({ assignee: issue.assignee }) }] };
    }

    case "search_issues": {
      const results = store.searchIssues(a.query);
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
});

// When run as a standalone process, connect via stdio
const transport = new StdioServerTransport();
await server.connect(transport);
