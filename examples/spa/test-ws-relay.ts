#!/usr/bin/env bun
/**
 * WebSocket relay for testing SPA examples with the CLI.
 *
 * The SPA connects outbound to ws://localhost:9339/slop (provider side).
 * The CLI connects to ws://localhost:9340/slop (consumer side).
 * This relay bridges them: messages from the SPA are forwarded to the CLI and vice versa.
 *
 * Usage:
 *   bun run test-ws-relay.ts
 *
 * Then:
 *   1. Start any SPA example (bun run dev in react/, vue/, etc.)
 *   2. Connect CLI: cd cli && go run . --connect ws://localhost:9340/slop
 */

const providerClients = new Set<any>();
const consumerClients = new Set<any>();

// Port 9339: SPA providers connect here
const providerServer = Bun.serve({
  port: 9339,
  fetch(req, server) {
    if (server.upgrade(req)) return undefined;
    return new Response("SLOP WS Relay (provider port)", { status: 200 });
  },
  websocket: {
    open(ws) {
      console.log("[relay] Provider connected");
      providerClients.add(ws);
    },
    message(ws, message) {
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      // Forward provider messages to all consumers
      for (const consumer of consumerClients) {
        consumer.send(text);
      }
    },
    close(ws) {
      console.log("[relay] Provider disconnected");
      providerClients.delete(ws);
    },
  },
});

// Port 9340: CLI consumers connect here
const consumerServer = Bun.serve({
  port: 9340,
  fetch(req, server) {
    if (server.upgrade(req)) return undefined;
    return new Response("SLOP WS Relay (consumer port)", { status: 200 });
  },
  websocket: {
    open(ws) {
      console.log("[relay] Consumer connected");
      consumerClients.add(ws);
      // Send a connect message to the provider so it sends hello
      for (const provider of providerClients) {
        provider.send(JSON.stringify({ type: "connect" }));
      }
    },
    message(ws, message) {
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      // Forward consumer messages to all providers
      for (const provider of providerClients) {
        provider.send(text);
      }
    },
    close(ws) {
      console.log("[relay] Consumer disconnected");
      consumerClients.delete(ws);
    },
  },
});

console.log(`[relay] Provider port: ws://localhost:${providerServer.port}/slop`);
console.log(`[relay] Consumer port: ws://localhost:${consumerServer.port}/slop`);
console.log(`[relay] Start an SPA example, then connect CLI: go run ./cli --connect ws://localhost:${consumerServer.port}/slop`);
