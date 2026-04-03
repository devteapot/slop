export interface Repo {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "private";
}

export interface Issue {
  id: string;
  repoId: string;
  title: string;
  body: string;
  status: "open" | "closed";
  labels: string[];
  assignee: string | null;
  createdAt: string;
}

export interface Comment {
  id: string;
  issueId: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface Label {
  id: string;
  repoId: string;
  name: string;
  color: string;
}

export class IssueTrackerStore {
  repos: Repo[] = [];
  issues: Issue[] = [];
  comments: Comment[] = [];
  labels: Label[] = [];

  private nextIssueId = 1;
  private nextCommentId = 1;

  // --- Repos ---

  listRepos(): Repo[] {
    return this.repos;
  }

  getRepo(repoId: string): Repo | undefined {
    return this.repos.find((r) => r.id === repoId);
  }

  // --- Issues ---

  listIssues(
    repoId: string,
    filters?: { status?: "open" | "closed"; label?: string },
  ): Issue[] {
    let issues = this.issues.filter((i) => i.repoId === repoId);
    if (filters?.status) issues = issues.filter((i) => i.status === filters.status);
    if (filters?.label) issues = issues.filter((i) => i.labels.includes(filters.label!));
    return issues;
  }

  getIssue(issueId: string): Issue | undefined {
    return this.issues.find((i) => i.id === issueId);
  }

  createIssue(repoId: string, title: string, body: string, labels?: string[]): Issue {
    const issue: Issue = {
      id: `issue-${this.nextIssueId++}`,
      repoId,
      title,
      body,
      status: "open",
      labels: labels ?? [],
      assignee: null,
      createdAt: new Date().toISOString(),
    };
    this.issues.push(issue);
    return issue;
  }

  closeIssue(issueId: string): Issue | undefined {
    const issue = this.getIssue(issueId);
    if (issue) issue.status = "closed";
    return issue;
  }

  reopenIssue(issueId: string): Issue | undefined {
    const issue = this.getIssue(issueId);
    if (issue) issue.status = "open";
    return issue;
  }

  assignIssue(issueId: string, assignee: string): Issue | undefined {
    const issue = this.getIssue(issueId);
    if (issue) issue.assignee = assignee;
    return issue;
  }

  addLabel(issueId: string, label: string): Issue | undefined {
    const issue = this.getIssue(issueId);
    if (issue && !issue.labels.includes(label)) issue.labels.push(label);
    return issue;
  }

  removeLabel(issueId: string, label: string): Issue | undefined {
    const issue = this.getIssue(issueId);
    if (issue) issue.labels = issue.labels.filter((l) => l !== label);
    return issue;
  }

  // --- Comments ---

  listComments(issueId: string): Comment[] {
    return this.comments.filter((c) => c.issueId === issueId);
  }

  addComment(issueId: string, author: string, body: string): Comment {
    const comment: Comment = {
      id: `comment-${this.nextCommentId++}`,
      issueId,
      author,
      body,
      createdAt: new Date().toISOString(),
    };
    this.comments.push(comment);
    return comment;
  }

  // --- Search ---

  searchIssues(query: string): Issue[] {
    const q = query.toLowerCase();
    return this.issues.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.body.toLowerCase().includes(q) ||
        i.labels.some((l) => l.toLowerCase().includes(q)),
    );
  }

  // --- Labels (per repo) ---

  getRepoLabels(repoId: string): Label[] {
    return this.labels.filter((l) => l.repoId === repoId);
  }

  // --- Reset ---

  reset(seed: { repos: Repo[]; issues: Issue[]; comments: Comment[]; labels: Label[] }): void {
    this.repos = structuredClone(seed.repos);
    this.issues = structuredClone(seed.issues);
    this.comments = structuredClone(seed.comments);
    this.labels = structuredClone(seed.labels);
    // Set next IDs based on seed data
    const maxIssue = this.issues.reduce((max, i) => {
      const n = parseInt(i.id.replace("issue-", ""), 10);
      return n > max ? n : max;
    }, 0);
    const maxComment = this.comments.reduce((max, c) => {
      const n = parseInt(c.id.replace("comment-", ""), 10);
      return n > max ? n : max;
    }, 0);
    this.nextIssueId = maxIssue + 1;
    this.nextCommentId = maxComment + 1;
  }
}
