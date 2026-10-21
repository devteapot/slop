/**
 * Stdio MCP server for the file-browser benchmark app.
 * Env vars: BENCH_SCALE (s|m|l|xl), BENCH_SEED (int).
 */
import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { FileBrowserStore } from "./store.ts";
import { seedFileBrowser } from "./seed.ts";
import type { DataScale } from "../../runner/types.ts";

const scale = (process.env.BENCH_SCALE as DataScale | undefined) ?? "s";
const seed = Number(process.env.BENCH_SEED ?? 42);

const store = new FileBrowserStore();
const { dirs, files } = seedFileBrowser(scale, seed);
store.reset(dirs, files);

const server = new Server({ name: "file-browser-mcp", version: "0.2.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "list_dir", description: "List the direct children (dirs and files) of a directory", inputSchema: { type: "object" as const, properties: { path: { type: "string", description: "Directory path, e.g. / or /src" } }, required: ["path"] } },
    { name: "list_all_dirs", description: "List every directory in the tree, recursively", inputSchema: { type: "object" as const, properties: {} } },
    { name: "list_all_files", description: "List every file in the tree, recursively", inputSchema: { type: "object" as const, properties: {} } },
    { name: "read_file", description: "Return a file's full contents", inputSchema: { type: "object" as const, properties: { path: { type: "string", description: "File path" } }, required: ["path"] } },
    { name: "delete_file", description: "Delete a file", inputSchema: { type: "object" as const, properties: { path: { type: "string" } }, required: ["path"] } },
    { name: "delete_dir", description: "Delete a directory (must be empty)", inputSchema: { type: "object" as const, properties: { path: { type: "string" } }, required: ["path"] } },
    { name: "create_dir", description: "Create a new empty directory as a child of another", inputSchema: { type: "object" as const, properties: { parent: { type: "string" }, name: { type: "string" } }, required: ["parent", "name"] } },
    { name: "rename_file", description: "Rename a file (keeps it in the same directory)", inputSchema: { type: "object" as const, properties: { path: { type: "string" }, new_name: { type: "string" } }, required: ["path", "new_name"] } },
    { name: "move_file", description: "Move a file into another directory", inputSchema: { type: "object" as const, properties: { path: { type: "string" }, new_parent: { type: "string" } }, required: ["path", "new_parent"] } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const a = (args ?? {}) as Record<string, unknown>;
  try {
    switch (name) {
      case "list_dir": {
        const d = store.getDir(String(a.path));
        if (!d) return err(`dir ${a.path} not found`);
        return json({
          path: d.path,
          dirs: d.dirs.map((p) => ({ path: p, name: store.getDir(p)?.name, is_empty: store.isDirEmpty(p) })),
          files: d.files.map((p) => ({ path: p, name: store.getFile(p)?.name, size_bytes: store.getFile(p)?.sizeBytes })),
        });
      }
      case "list_all_dirs":
        return json(store.listDirs().map((d) => ({ path: d.path, is_empty: store.isDirEmpty(d.path), child_dirs: d.dirs.length, child_files: d.files.length })));
      case "list_all_files":
        return json(store.listFiles().map((f) => ({ path: f.path, name: f.name, size_bytes: f.sizeBytes })));
      case "read_file": {
        const f = store.getFile(String(a.path));
        if (!f) return err(`file ${a.path} not found`);
        return json({ path: f.path, content: f.content });
      }
      case "delete_file":
        store.deleteFile(String(a.path));
        return json({ deleted: a.path });
      case "delete_dir":
        store.deleteDir(String(a.path));
        return json({ deleted: a.path });
      case "create_dir":
        store.createDir(String(a.parent), String(a.name));
        return json({ created: `${a.parent}/${a.name}` });
      case "rename_file":
        store.renameFile(String(a.path), String(a.new_name));
        return json({ renamed: a.path, to: a.new_name });
      case "move_file":
        store.moveFile(String(a.path), String(a.new_parent));
        return json({ moved: a.path, to: a.new_parent });
      default:
        return err(`unknown tool ${name}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
});

function json(data: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}
function err(msg: string) {
  return { content: [{ type: "text", text: JSON.stringify({ error: msg }) }], isError: true };
}

const transport = new StdioServerTransport();
await server.connect(transport);
