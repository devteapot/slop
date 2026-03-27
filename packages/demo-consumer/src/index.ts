import type { SlopNode, ResultMessage } from "@slop/types";
import {
  SlopConsumer,
  UnixClientTransport,
  listProviders,
  findProvider,
  transportForDescriptor,
} from "@slop/consumer";
import { createInterface } from "node:readline";

async function main() {
  const arg = process.argv[2];
  let transport;

  if (arg) {
    // Try discovery first, then treat as socket path
    const desc = findProvider(arg);
    if (desc) {
      transport = transportForDescriptor(desc);
    } else {
      transport = new UnixClientTransport(arg);
    }
  } else {
    const providers = listProviders();
    if (providers.length === 0) {
      console.log("No SLOP providers found. Start one first:");
      console.log("  bun run demo");
      process.exit(1);
    }
    console.log(`Found ${providers.length} provider(s):`);
    providers.forEach((p, i) => console.log(`  [${i}] ${p.name} (${p.id})`));
    transport = transportForDescriptor(providers[0]);
  }

  const consumer = new SlopConsumer({ transport });

  console.log("Connecting...");
  const hello = await consumer.connect();
  console.log(
    `Connected to ${hello.provider.name} (SLOP v${hello.provider.slop_version})`
  );
  console.log(`Capabilities: ${hello.provider.capabilities.join(", ")}\n`);

  const { id: subId, snapshot } = await consumer.subscribe("/", -1);
  printTree(snapshot);

  consumer.on("patch", (subscriptionId: string, ops: any[], version: number) => {
    console.log(`\n--- Patch v${version} (${ops.length} op${ops.length === 1 ? "" : "s"}) ---\n`);
    const tree = consumer.getTree(subscriptionId);
    if (tree) printTree(tree);
    rl.prompt();
  });

  consumer.on("disconnect", () => {
    console.log("\nDisconnected from provider.");
    process.exit(0);
  });

  // Interactive REPL
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.setPrompt("slop> ");

  console.log("\nCommands:");
  console.log("  tree                              — show current state");
  console.log("  invoke <path> <action> [json]      — invoke an affordance");
  console.log("  affordances [path]                 — list available actions");
  console.log("  query <path> [depth]               — one-shot query");
  console.log("  quit                               — disconnect and exit\n");
  rl.prompt();

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    const [cmd, ...args] = trimmed.split(/\s+/);

    try {
      switch (cmd) {
        case "tree":
        case "t": {
          const tree = consumer.getTree(subId);
          if (tree) printTree(tree);
          break;
        }

        case "invoke":
        case "i": {
          const [path, action, ...rest] = args;
          if (!path || !action) {
            console.log("Usage: invoke <path> <action> [json-params]");
            break;
          }
          const params = rest.length
            ? JSON.parse(rest.join(" "))
            : undefined;
          const result = await consumer.invoke(path, action, params);
          if (result.status === "ok") {
            console.log("OK" + (result.data ? `: ${JSON.stringify(result.data)}` : ""));
          } else {
            console.log(`Error [${result.error?.code}]: ${result.error?.message}`);
          }
          break;
        }

        case "affordances":
        case "a": {
          const tree = consumer.getTree(subId);
          if (tree) printAffordances(tree, args[0] || "/");
          break;
        }

        case "query":
        case "q": {
          const [path, depthStr] = args;
          const result = await consumer.query(path || "/", Number(depthStr) || -1);
          printTree(result);
          break;
        }

        case "quit":
        case "exit": {
          consumer.disconnect();
          process.exit(0);
        }

        default:
          console.log(`Unknown command: ${cmd}`);
          console.log("Commands: tree, invoke, affordances, query, quit");
      }
    } catch (err: any) {
      console.log(`Error: ${err.message}`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    consumer.disconnect();
    process.exit(0);
  });
}

function printTree(node: SlopNode, indent = 0): void {
  const pad = "  ".repeat(indent);
  const props = node.properties ?? {};
  const label = (props.label ?? props.title ?? node.id) as string;

  const extra = Object.entries(props)
    .filter(([k]) => k !== "label" && k !== "title")
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");

  const affordances = (node.affordances ?? []).map((a) => a.action).join(", ");

  let line = `${pad}[${node.type}] ${label}`;
  if (extra) line += ` (${extra})`;
  if (affordances) line += `  {${affordances}}`;
  console.log(line);

  for (const child of node.children ?? []) {
    printTree(child, indent + 1);
  }
}

function printAffordances(node: SlopNode, targetPath: string): void {
  const target = resolvePath(node, targetPath);
  if (!target) {
    console.log(`Path not found: ${targetPath}`);
    return;
  }

  const affordances = target.affordances ?? [];
  if (affordances.length === 0) {
    console.log(`No affordances on ${targetPath}`);
    return;
  }

  console.log(`Affordances on ${targetPath}:`);
  for (const a of affordances) {
    let line = `  ${a.action}`;
    if (a.label) line += ` — ${a.label}`;
    if (a.dangerous) line += " [DANGEROUS]";
    if (a.params?.properties) {
      const params = Object.entries(a.params.properties)
        .map(([k, v]) => `${k}: ${v.type}`)
        .join(", ");
      line += ` (${params})`;
    }
    console.log(line);
  }

  // Also show child affordances
  for (const child of target.children ?? []) {
    const childAffordances = child.affordances ?? [];
    if (childAffordances.length > 0) {
      const actions = childAffordances.map((a) => a.action).join(", ");
      console.log(`  ${targetPath === "/" ? "" : targetPath}/${child.id}: {${actions}}`);
    }
  }
}

function resolvePath(node: SlopNode, path: string): SlopNode | null {
  if (path === "/" || path === "") return node;
  const segments = path.split("/").filter(Boolean);
  let current = node;
  for (const seg of segments) {
    const child = current.children?.find((c) => c.id === seg);
    if (!child) return null;
    current = child;
  }
  return current;
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
