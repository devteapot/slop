# MCP SEP Drafts

The SLOP project drafts MCP SEPs here before submitting them to the [Model Context Protocol specification repository](https://github.com/modelcontextprotocol/modelcontextprotocol/tree/main/seps).

Nothing in this directory is an accepted MCP SEP. Each file is a working draft that will be moved into the MCP `seps/` directory once it has a sponsor and a reference implementation. See the [MCP SEP Guidelines](https://modelcontextprotocol.io/community/sep-guidelines) for the full process.

## Current drafts

| File | Proposal | Status |
|---|---|---|
| [`0000-slop-over-mcp.md`](./0000-slop-over-mcp.md) | SLOP over MCP — state-tree subscriptions and affordance invocation as an MCP extension | Idea (pre-sponsor) |

## Why keep drafts here

- Keeps SEP drafts versioned alongside the SLOP spec so motivation and wire details stay in sync.
- Lets the reference implementation land in the SLOP SDK before we open the upstream PR.
- Makes it obvious where to look for in-flight proposals that affect the SLOP surface.

When a draft is ready to submit, it moves into the MCP `seps/` directory as a PR. The file here is then replaced by a short pointer to the upstream PR so history is preserved.
