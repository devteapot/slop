# @slop-ai/bridge-server

Hosted bridge for SLOP relay clients and remote MCP hosts.

The bridge exposes:

- `POST /mcp`, `GET /mcp`, and `DELETE /mcp` for Streamable HTTP MCP clients.
- `GET /relay` as an authenticated WebSocket endpoint for `slop-relay`.
- `GET /healthz` for health checks.

## Configuration

`SLOP_BRIDGE_USERS` is required. It is a JSON object keyed by user id:

```json
{
  "user_123": {
    "mcpToken": "mcp-token-at-least-16-chars",
    "relayToken": "relay-token-at-least-16-chars",
    "label": "optional display label"
  }
}
```

MCP hosts connect with `Authorization: Bearer <mcpToken>`.

Local relay agents connect with `Authorization: Bearer <relayToken>`.

## Local Development

```sh
SLOP_BRIDGE_USERS='{"dev":{"mcpToken":"dev-mcp-token-0001","relayToken":"dev-relay-token-0001"}}' \
  bun run dev -- --port 8080
```

Point `slop-relay` at the bridge:

```sh
SLOP_RELAY_TOKEN=dev-relay-token-0001 \
  slop-relay --url ws://localhost:8080/relay
```

Use `http://localhost:8080/mcp` as the remote MCP URL with the MCP token.

## Build

```sh
bun run build
```
