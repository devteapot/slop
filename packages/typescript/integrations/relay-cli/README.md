# @slop-ai/relay-cli

Outbound relay agent for SLOP providers.

`slop-relay` runs on a user's machine, discovers local SLOP apps with
`@slop-ai/discovery`, and connects outbound to a hosted bridge over WebSocket.
The hosted bridge is responsible for exposing those providers to remote MCP
hosts.

## Usage

```sh
slop-relay --token "$SLOP_RELAY_TOKEN"
slop-relay --url ws://localhost:9999 --token dev --verbose
```

Configuration precedence:

1. `--url`, then `SLOP_RELAY_URL`, then `wss://bridge.slopai.dev/relay`
2. `--token`, then `SLOP_RELAY_TOKEN`, then `~/.slop/relay.json`

`slop-relay login` is a placeholder in v1. Real OAuth login lands with the
hosted bridge.

## Development

```sh
bun install
cd packages/typescript/integrations/relay-cli
bun run dev -- --url ws://localhost:9999 --token dev --verbose
bun test
bun run build
```
