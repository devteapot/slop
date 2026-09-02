import { SlopServer } from "@slop-ai/server";
import { bunHandler } from "@slop-ai/server/bun";
import type { NodeDescriptor } from "@slop-ai/core";
import type { DirNode, FileBrowserStore, FileNode } from "./store.ts";

export interface FileBrowserSlopOpts {
  maxNodes?: number;
  maxDepth?: number;
  /**
   * optimized=true: directories beyond depth 2 become lazy stubs (no inline
   * children; agent must slop_query them). off=false inlines the whole tree.
   */
  optimized?: boolean;
}

/**
 * The path-to-SLOP mapping strips the leading "/" and uses the result as
 * the register key. Root ("/") is registered as "tree" so there's always a
 * canonical entry point above the first real directory.
 */
function slopPath(storePath: string): string {
  if (storePath === "/") return "tree";
  return `tree${storePath}`;
}

export function createFileBrowserSlopServer(store: FileBrowserStore, opts?: FileBrowserSlopOpts) {
  const slop = new SlopServer({
    id: "file-browser",
    name: "File Browser",
    ...(opts?.maxNodes != null && { maxNodes: opts.maxNodes }),
    ...(opts?.maxDepth != null && { maxDepth: opts.maxDepth }),
  });

  const optimized = opts?.optimized ?? false;

  slop.register("overview", () => {
    const totalDirs = store.listDirs().length;
    const totalFiles = store.listFiles().length;
    const emptyDirs = store.listDirs().filter((d) => d.path !== "/" && store.isDirEmpty(d.path)).length;
    return {
      type: "context",
      props: {
        total_dirs: totalDirs,
        total_files: totalFiles,
        empty_dirs: emptyDirs,
      },
      summary: `${totalDirs} directories (${emptyDirs} empty), ${totalFiles} files`,
    };
  });

  const registerDir = (dir: DirNode, depth: number) => {
    slop.register(slopPath(dir.path), () => {
      const current = store.getDir(dir.path);
      if (!current) return { type: "missing" } satisfies NodeDescriptor;
      const isDeep = optimized && depth >= 2;
      const children: Record<string, NodeDescriptor> = {};
      if (!isDeep) {
        for (const childDirPath of current.dirs) {
          const child = store.getDir(childDirPath);
          if (child) children[child.name] = buildDirStub(child, store);
        }
        for (const filePath of current.files) {
          const file = store.getFile(filePath);
          if (file) children[file.name] = buildFileNode(store, slop, file);
        }
      }
      const node: NodeDescriptor = {
        type: "dir",
        props: {
          path: current.path,
          child_dirs: current.dirs.length,
          child_files: current.files.length,
          is_empty: store.isDirEmpty(current.path),
        },
        summary: isDeep
          ? `${current.dirs.length} subdirs, ${current.files.length} files (lazy — use slop_query to load)`
          : undefined,
        actions: {
          create_file: {
            label: "Create file",
            description: "Create a new file inside this directory",
            params: {
              name: { type: "string", description: "New file name" },
              content: { type: "string", description: "File contents" },
            },
            handler: async (p) => {
              // No first-class createFile on the store — not needed by current scenarios.
              slop.refresh();
              return { error: "create_file not supported" };
            },
          },
          create_subdir: {
            label: "Create subdirectory",
            description: "Create a new empty directory inside this one",
            params: { name: { type: "string", description: "New directory name" } },
            handler: async (p) => {
              store.createDir(current.path, String(p.name));
              slop.refresh();
              return { id: current.path };
            },
          },
        },
      };
      // State-dependent: delete is only available when the dir is empty and non-root.
      if (current.path !== "/" && store.isDirEmpty(current.path)) {
        node.actions!.delete = {
          label: "Delete empty directory",
          description: "Delete this directory (only available when empty)",
          params: {},
          handler: async () => {
            store.deleteDir(current.path);
            slop.refresh();
            return { deleted: current.path };
          },
        };
      }
      if (!isDeep) {
        node.children = children;
      }
      return node;
    });

    if (optimized && depth >= 2) return;
    for (const childPath of dir.dirs) {
      const child = store.getDir(childPath);
      if (child) registerDir(child, depth + 1);
    }
  };

  const root = store.getDir("/");
  if (root) registerDir(root, 0);

  return slop;
}

function buildDirStub(dir: DirNode, store: FileBrowserStore): NodeDescriptor {
  return {
    type: "dir-stub",
    props: {
      path: dir.path,
      name: dir.name,
      is_empty: store.isDirEmpty(dir.path),
    },
    summary: `${dir.dirs.length} subdirs, ${dir.files.length} files`,
  };
}

function buildFileNode(store: FileBrowserStore, slop: SlopServer, file: FileNode): NodeDescriptor {
  return {
    type: "file",
    props: {
      path: file.path,
      name: file.name,
      size_bytes: file.sizeBytes,
      // Small preview only — the real content comes via the read_file affordance.
      preview: file.content.slice(0, 80),
    },
    actions: {
      read_file: {
        label: "Read file",
        description: "Return the full contents of this file",
        params: {},
        handler: async () => {
          const current = store.getFile(file.path);
          return { path: file.path, content: current?.content ?? "" };
        },
      },
      delete_file: {
        label: "Delete file",
        description: "Delete this file",
        params: {},
        handler: async () => {
          store.deleteFile(file.path);
          slop.refresh();
          return { deleted: file.path };
        },
      },
    },
  };
}

export function startFileBrowserSlopServer(store: FileBrowserStore, port: number, opts?: FileBrowserSlopOpts) {
  const slop = createFileBrowserSlopServer(store, opts);
  const handler = bunHandler(slop, { path: "/slop" });
  const server = Bun.serve({
    port,
    fetch(req, srv) {
      const resp = handler.fetch(req, srv);
      if (resp) return resp;
      return new Response("SLOP File Browser benchmark server", { status: 200 });
    },
    websocket: handler.websocket,
  });
  return { server, slop };
}
