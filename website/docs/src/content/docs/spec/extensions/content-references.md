---
title: "Content References"
---
SLOP state trees are JSON. This works well for structured data — properties, collections, affordances. But some application state is **large, binary, or opaque**: document bodies, file contents, images, audio, video, database exports, logs.

Inlining this content in the tree is wasteful, impractical, or impossible. Content references solve this by letting nodes **point to content** rather than contain it.

## The problem

A code editor's state tree might include an open file:

```jsonc
{
  "id": "main.ts",
  "type": "document",
  "properties": {
    "title": "main.ts",
    "language": "typescript",
    "content": "import { createSlop } from '@slop-ai/core';\n\nexport const slop = createSlop({\n  id: 'my-app',\n  ... (500 more lines)"
  }
}
```

Problems:
- A 500-line file inlined in the tree wastes thousands of tokens on content the AI may not need
- Binary files (images, PDFs) can't be represented in JSON at all
- The tree is diffed on every state change — including file content that didn't change
- Multiple open files multiply the problem

## Content references

Instead of inlining content, the node declares a **reference** to content that can be fetched on demand:

```jsonc
{
  "id": "main.ts",
  "type": "document",
  "properties": {
    "title": "main.ts",
    "language": "typescript",
    "line_count": 500,
    "size_bytes": 12400
  },
  "content_ref": {
    "type": "text",
    "mime": "text/typescript",
    "size": 12400,
    "uri": "slop://content/main.ts",
    "summary": "TypeScript module. Exports createSlop client, defines routes, registers 3 SLOP nodes."
  }
}
```

The AI sees the document exists, knows its language, size, and a natural language summary of what's in it — without loading 500 lines into the tree. If the AI needs the actual content, it requests it explicitly.

## Content reference schema

```jsonc
{
  "content_ref": {
    "type": "text" | "binary" | "stream",    // Content category
    "mime": "text/typescript",                 // MIME type
    "size": 12400,                             // Size in bytes (approximate for streams)
    "uri": "slop://content/main.ts",           // How to fetch it
    "summary": "TypeScript module...",          // NL summary for AI context
    "preview": "import { createSlop }...",     // Optional: first N characters/lines
    "encoding": "utf-8",                       // For text content
    "hash": "sha256:abc123..."                 // Optional: content hash for caching
  }
}
```

### Fields

| Field | Required | Type | Description |
|---|---|---|---|
| `type` | yes | string | `"text"`, `"binary"`, or `"stream"` |
| `mime` | yes | string | MIME type of the content |
| `size` | no | number | Size in bytes (helps AI estimate token cost) |
| `uri` | yes | string | How to fetch the content (see URI schemes below) |
| `summary` | yes | string | Natural language summary for AI comprehension |
| `preview` | no | string | First N characters or a representative snippet |
| `encoding` | no | string | Character encoding for text content (default: utf-8) |
| `hash` | no | string | Content hash for cache invalidation |

### Content types

**`text`** — text content that can be read as a string. Documents, source code, logs, configuration files. The AI can read this directly.

**`binary`** — binary content that requires interpretation. Images, PDFs, audio, video, compiled files. The AI needs a vision model or specialized tool to process this.

**`stream`** — ongoing content that grows over time. Log streams, terminal output, real-time data feeds. The consumer reads a window of the stream.

## URI schemes

The `uri` field tells the consumer how to fetch the content:

### `slop://` — fetch via SLOP invoke

The content is fetched through a SLOP affordance. The provider handles the actual retrieval.

```
slop://content/main.ts
```

The consumer sends:
```jsonc
{ "type": "invoke", "id": "req-1", "path": "/editor/main.ts", "action": "read_content", "params": {} }
```

The provider responds with the content in the result:
```jsonc
{ "type": "result", "id": "req-1", "status": "ok", "data": { "content": "import { createSlop }...", "encoding": "utf-8" } }
```

This is the **recommended scheme** for most cases. It uses the existing SLOP transport (no extra connections), the provider controls access, and it works across all transports (WebSocket, Unix socket, postMessage).

### `file://` — local file path

For local applications (desktop, CLI), the content is a file on disk:

```
file:///Users/alice/project/src/main.ts
```

The consumer reads the file directly. Only valid for consumers that have filesystem access (desktop app, CLI agents). Not valid for browser-based consumers.

### `http://` / `https://` — fetch via HTTP

The content is available at an HTTP URL:

```
https://api.example.com/files/main.ts?token=...
```

The consumer fetches it with a standard HTTP request. Useful for server-backed apps where content is stored in a CMS, S3, or database.

### `data:` — inline small content

For small content that doesn't warrant a round-trip, inline it as a data URI:

```
data:text/plain;base64,SGVsbG8gV29ybGQ=
```

This defeats the purpose of content references for large content, but is useful for icons, thumbnails, or small metadata blobs.

## Developer API

In the `@slop-ai/core` descriptor format:

```ts
slop.register("editor/main-ts", {
  type: "document",
  props: {
    title: "main.ts",
    language: "typescript",
    line_count: file.lineCount,
    dirty: file.isDirty,
  },
  // Content reference — not inlined in the tree
  contentRef: {
    type: "text",
    mime: "text/typescript",
    size: file.content.length,
    summary: "TypeScript module. Exports SLOP client, defines app routes.",
    preview: file.content.slice(0, 200),
  },
  actions: {
    read_content: () => ({ content: file.content, encoding: "utf-8" }),
    write_content: {
      params: { content: "string" },
      handler: ({ content }) => file.write(content as string),
    },
  },
});
```

The `contentRef` field on the descriptor:
- Gets translated to a `content_ref` on the SlopNode
- The `uri` is auto-generated as `slop://content/{path}` (backed by the `read_content` action)
- The consumer sees the reference and can invoke `read_content` to fetch

If the developer provides a `uri` explicitly, the library uses it instead of auto-generating:

```ts
contentRef: {
  type: "binary",
  mime: "image/png",
  size: 45000,
  uri: "https://cdn.example.com/images/photo.png",
  summary: "User profile photo, 400x400px",
},
```

## Content in the AI context

When the AI receives a state tree with content references, it sees:

```
[document] main.ts (language="typescript", line_count=500, dirty=false)
  content: text/typescript, 12.4 KB
  summary: "TypeScript module. Exports SLOP client, defines app routes."
  preview: "import { createSlop } from '@slop-ai/core';\n..."
  actions: {read_content, write_content(content)}
```

The AI can decide:
- **Skip it** — the summary tells it enough for most questions
- **Read it** — invoke `read_content` to get the full text (costs tokens, but AI chooses when)
- **Modify it** — invoke `write_content` with new content

This is the equivalent of a developer glancing at a file tab (sees the name, language, dirty state) versus opening and reading the file. The AI makes the same choice.

## Multiple content on a node

A node can have multiple content references (e.g., a message with attachments):

```ts
slop.register("inbox/msg-42", {
  type: "item",
  props: { from: "alice", subject: "Q3 Report" },
  contentRef: {
    type: "text",
    mime: "text/html",
    summary: "Email body: discusses Q3 results, 3 paragraphs",
  },
  children: {
    "attachment-1": {
      type: "document",
      props: { filename: "report.pdf", size: 2400000 },
      contentRef: {
        type: "binary",
        mime: "application/pdf",
        size: 2400000,
        uri: "https://mail.example.com/attachments/report.pdf",
        summary: "PDF: Q3 Financial Report, 24 pages, contains charts and tables",
      },
    },
  },
  actions: {
    read_body: () => ({ content: message.body, encoding: "utf-8" }),
    reply: { params: { body: "string" }, handler: ({ body }) => sendReply(body as string) },
  },
});
```

## Streaming content

For content that grows over time (logs, terminal output), use `type: "stream"`:

```ts
slop.register("terminal/output", {
  type: "document",
  props: { shell: "zsh", cwd: "/project" },
  contentRef: {
    type: "stream",
    mime: "text/plain",
    summary: "Terminal output. Last command: npm test (running)",
    preview: terminalBuffer.slice(-500),  // last 500 chars
  },
  actions: {
    read_content: {
      params: { lines: "number" },  // how many lines to fetch
      handler: ({ lines }) => ({ content: terminalBuffer.slice(-(lines as number)) }),
    },
    send_input: {
      params: { text: "string" },
      handler: ({ text }) => terminal.write(text as string),
    },
  },
});
```

The `preview` field on streams typically contains the most recent output. The consumer can read more via `read_content` with a `lines` parameter.

## Security considerations

- **Content references don't bypass access control.** The provider validates permissions on `read_content` just like any other affordance invocation.
- **`file://` URIs expose local paths.** Only use for local consumers (desktop, CLI). Never expose to remote consumers.
- **`http://` URIs may include tokens.** Use short-lived tokens or signed URLs. Don't embed long-lived secrets.
- **Binary content and AI.** Current LLMs can't process arbitrary binary data. Content references for binary types are primarily informational (the AI sees the metadata and summary). Vision models can process images via their native APIs if the consumer supports it.

## When to use content references vs inline

| Content | Approach | Why |
|---|---|---|
| Title, status, count | Inline in `props` | Small, always relevant |
| Short text (< 500 chars) | Inline in `props` or `preview` | Fits in context, no round-trip needed |
| Document body (500+ chars) | Content reference | Too large to inline, AI may not need it |
| Source code files | Content reference | Can be large, summary + preview usually sufficient |
| Images, PDFs, audio | Content reference (binary) | Can't be inlined in JSON |
| Log output, terminal | Content reference (stream) | Grows over time, preview + tail access |
| Database query results | Content reference or windowed collection | Depends on size |
