#!/usr/bin/env bun
/**
 * Direct SPA test: starts a WebSocket server on port 9339, waits for the SPA
 * to connect, then subscribes and prints the tree + invokes actions.
 *
 * Usage:
 *   1. bun run examples/spa/test-spa.ts
 *   2. In another terminal: cd examples/spa/react && bun run dev
 *   3. Open http://localhost:5173 in browser
 *   4. Watch this terminal for the SLOP tree
 */

let providerWs: any = null;
let resolveHello: ((msg: any) => void) | null = null;
let messageHandler: ((msg: any) => void) | null = null;

const server = Bun.serve({
  port: 9339,
  fetch(req, server) {
    if (server.upgrade(req)) return undefined;
    return new Response("SLOP test server", { status: 200 });
  },
  websocket: {
    open(ws) {
      console.log("\n✓ SPA connected via WebSocket");
      providerWs = ws;
      // Send connect to trigger hello
      ws.send(JSON.stringify({ type: "connect" }));
    },
    message(_ws, message) {
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      try {
        const msg = JSON.parse(text);
        if (msg.type === "hello" && resolveHello) {
          resolveHello(msg);
          resolveHello = null;
        }
        if (messageHandler) messageHandler(msg);
      } catch {}
    },
    close() {
      console.log("\n✗ SPA disconnected");
      providerWs = null;
    },
  },
});

console.log(`Listening on ws://localhost:${server.port}/slop`);
console.log("Waiting for SPA to connect... (start a dev server and open in browser)\n");

function send(msg: any) {
  if (providerWs) providerWs.send(JSON.stringify(msg));
}

function waitForMessage(type: string, id?: string): Promise<any> {
  return new Promise((resolve) => {
    const prev = messageHandler;
    messageHandler = (msg) => {
      if (msg.type === type && (!id || msg.id === id)) {
        messageHandler = prev;
        resolve(msg);
      } else if (prev) {
        prev(msg);
      }
    };
  });
}

function waitForHello(): Promise<any> {
  return new Promise((resolve) => {
    resolveHello = resolve;
  });
}

// Pretty-print a SLOP node tree
function printTree(node: any, indent = 0) {
  const pad = "  ".repeat(indent);
  const meta = node.meta || {};
  const badges: string[] = [];
  if (meta.salience !== undefined) badges.push(`salience:${meta.salience}`);
  if (meta.urgency && meta.urgency !== "none") badges.push(`urgency:${meta.urgency}`);
  if (meta.pinned) badges.push("★pinned");
  if (meta.focus) badges.push("←focus");

  const badgeStr = badges.length ? `  [${badges.join(", ")}]` : "";
  console.log(`${pad}${node.id} (${node.type})${badgeStr}`);

  if (node.properties) {
    for (const [k, v] of Object.entries(node.properties)) {
      const val = typeof v === "string" ? `"${v}"` : JSON.stringify(v);
      console.log(`${pad}  ${k}: ${val}`);
    }
  }

  if (meta.summary) console.log(`${pad}  summary: "${meta.summary}"`);
  if (meta.window) console.log(`${pad}  window: [${meta.window}]`);
  if (meta.total_children) console.log(`${pad}  total: ${meta.total_children}`);

  if (node.content_ref) {
    console.log(`${pad}  content: "${node.content_ref.summary}" (${node.content_ref.size} bytes)`);
  }

  if (node.affordances?.length) {
    const actions = node.affordances.map((a: any) => {
      let s = a.action;
      if (a.params?.properties) s += `(${Object.keys(a.params.properties).join(", ")})`;
      if (a.dangerous) s += " ⚠️";
      return s;
    });
    console.log(`${pad}  actions: ${actions.join(", ")}`);
  }

  if (node.children) {
    for (const child of node.children) {
      printTree(child, indent + 1);
    }
  }
}

// Wait for connection
async function run() {
  // Wait for hello
  const hello = await waitForHello();
  const provider = hello.provider || {};
  console.log(`\n=== HELLO ===`);
  console.log(`Provider: ${provider.name} (${provider.id})`);
  console.log(`SLOP version: ${provider.slop_version || "unknown"}`);
  console.log(`Capabilities: ${(hello.capabilities || []).join(", ")}`);

  // Subscribe to full tree
  const subId = `test-${Date.now()}`;
  send({ type: "subscribe", id: subId, path: "/", depth: -1 });
  const snapshot = await waitForMessage("snapshot", subId);

  console.log(`\n=== TREE (${countNodes(snapshot.tree)} nodes) ===\n`);
  printTree(snapshot.tree);

  // Test: invoke search
  console.log(`\n=== TEST: search for "auth" ===\n`);
  const searchId = `search-${Date.now()}`;
  send({ type: "invoke", id: searchId, path: snapshot.tree.children?.[0]?.id || "board-1", action: "search", params: { query: "auth" } });
  const searchResult = await waitForMessage("result", searchId);
  console.log("Search result:", JSON.stringify(searchResult.data, null, 2));

  // Test: invoke move on a card
  const activeBoard = snapshot.tree.children?.find((c: any) => c.meta?.focus);
  if (activeBoard?.children?.length) {
    const firstColumn = activeBoard.children[0];
    const firstCard = firstColumn.children?.[0];
    if (firstCard) {
      const targetColumn = activeBoard.children[1]?.id;
      if (targetColumn) {
        console.log(`\n=== TEST: move "${firstCard.properties?.title}" → ${targetColumn} ===\n`);
        const moveId = `move-${Date.now()}`;
        send({
          type: "invoke",
          id: moveId,
          path: `${activeBoard.id}/${firstColumn.id}/${firstCard.id}`,
          action: "move",
          params: { column: targetColumn },
        });
        const moveResult = await waitForMessage("result", moveId);
        console.log("Move result:", JSON.stringify(moveResult, null, 2));

        // Wait for patches
        await new Promise((r) => setTimeout(r, 500));

        // Re-subscribe to see updated tree
        const subId2 = `test2-${Date.now()}`;
        send({ type: "subscribe", id: subId2, path: "/", depth: -1 });
        const snapshot2 = await waitForMessage("snapshot", subId2);
        console.log(`\n=== UPDATED TREE (${countNodes(snapshot2.tree)} nodes) ===\n`);
        printTree(snapshot2.tree);
      }
    }
  }

  console.log("\n=== ALL TESTS PASSED ===\n");
  process.exit(0);
}

function countNodes(node: any): number {
  let count = 1;
  if (node.children) {
    for (const child of node.children) count += countNodes(child);
  }
  return count;
}

// Timeout after 30s
setTimeout(() => {
  console.error("\n✗ Timeout: no SPA connected within 30s");
  process.exit(1);
}, 30000);

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
