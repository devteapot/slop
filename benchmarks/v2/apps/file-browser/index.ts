import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { FileBrowserStore } from "./store.ts";
import { seedFileBrowser } from "./seed.ts";
import { startFileBrowserSlopServer, type FileBrowserSlopOpts } from "./slop-server.ts";
import { fileBrowserScenarios } from "./scenarios.ts";
import type { AppBinding, AppStore, McpServerHandle, SlopServerHandle } from "../registry.ts";
import type { DataScale } from "../../runner/types.ts";
import type { Scenario, VerificationResult } from "../../../mcp-vs-slop/scenarios/types.ts";

function wrap(inner: FileBrowserStore): AppStore & { inner: FileBrowserStore } {
  return { __brand: "app-store", inner } as AppStore & { inner: FileBrowserStore };
}

export const fileBrowserApp: AppBinding = {
  id: "file-browser",
  supportedScales: ["s", "m", "l", "xl"],
  createStore(scale, seed) {
    const store = new FileBrowserStore();
    const { dirs, files } = seedFileBrowser(scale, seed);
    store.reset(dirs, files);
    return wrap(store);
  },
  async startSlopServer(store, port, opts): Promise<SlopServerHandle> {
    const inner = (store as unknown as { inner: FileBrowserStore }).inner;
    const { server, slop } = startFileBrowserSlopServer(inner, port, opts as FileBrowserSlopOpts | undefined);
    return {
      wsUrl: `ws://localhost:${port}/slop`,
      stop: async () => {
        slop.stop();
        server.stop();
      },
    };
  },
  scenarios: fileBrowserScenarios,
  verify(store, scenario) {
    if (!scenario.verify) return undefined;
    const inner = (store as unknown as { inner: FileBrowserStore }).inner;
    return scenario.verify(inner as unknown as Parameters<NonNullable<Scenario["verify"]>>[0]);
  },
  mcpSystemPrompt:
    "You are a file browser agent. You have tools to navigate a directory tree, read files, and mutate the tree. " +
    "Start by calling list_dir on '/' to see the root. " +
    'When the task is complete, respond with "DONE".',
  async startMcpServer(scale: DataScale, _variant: string): Promise<McpServerHandle> {
    // All current MCP variants share the flat server; prompt-level variants
    // are applied by the cell runner via resolveMcpVariant.
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    env.BENCH_SCALE = scale;
    env.BENCH_SEED = String(42);
    const serverPath = new URL("./mcp-server.ts", import.meta.url).pathname;
    const transport = new StdioClientTransport({
      command: "bun",
      args: ["run", serverPath],
      env,
    });
    const client = new Client({ name: "slop-benchmarks-v2", version: "0.2.0" });
    await client.connect(transport);
    return {
      client,
      stop: async () => {
        await client.close();
      },
      verify: async (scenario: Scenario): Promise<VerificationResult | undefined> => {
        if (!scenario.verify) return undefined;
        // Rebuild a FileBrowserStore by listing every dir and file.
        const [dRes, fRes] = await Promise.all([
          client.callTool({ name: "list_all_dirs", arguments: {} }),
          client.callTool({ name: "list_all_files", arguments: {} }),
        ]);
        const dirs = parseJson(dRes) as Array<{ path: string; child_dirs: number; child_files: number }>;
        const files = parseJson(fRes) as Array<{ path: string; name: string; size_bytes: number }>;
        // We need full dir relationships to verify "is empty". Do one more
        // pass per dir to get their children.
        const tempStore = new FileBrowserStore();
        const fullDirs = await Promise.all(
          dirs.map(async (d) => {
            const listRes = await client.callTool({ name: "list_dir", arguments: { path: d.path } });
            const listed = parseJson(listRes) as { dirs?: Array<{ path: string }>; files?: Array<{ path: string }> };
            return {
              path: d.path,
              name: d.path === "/" ? "" : d.path.slice(d.path.lastIndexOf("/") + 1),
              dirs: (listed.dirs ?? []).map((x) => x.path),
              files: (listed.files ?? []).map((x) => x.path),
            };
          }),
        );
        tempStore.reset(
          fullDirs,
          files.map((f) => ({ path: f.path, name: f.name, sizeBytes: f.size_bytes, content: "" })),
        );
        return scenario.verify(tempStore as unknown as Parameters<NonNullable<Scenario["verify"]>>[0]);
      },
    };
  },
};

function parseJson(result: unknown): unknown {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  const text = content.find((c) => c.type === "text")?.text ?? "[]";
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}
