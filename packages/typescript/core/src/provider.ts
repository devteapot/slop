/**
 * Shared provider logic used by both the client (in-browser) and server
 * (multi-connection) packages. Handles registrations, tree assembly,
 * diffing, handler resolution, invoke dispatch, and output tree generation.
 *
 * Subclasses override `getRegistrations()` to supply descriptors and
 * `broadcast()` to push updates to consumers.
 */

import type {
  SlopNode, PatchOp, ActionHandler, NodeDescriptor,
  SlopClientOptions,
} from "./types";
import { assembleTree } from "./tree-assembler";
import { diffNodes } from "./diff";
import { prepareTree, getSubtree } from "./scaling";

/** Subscription filter from a consumer's subscribe message. */
export interface SubscriptionFilter {
  types?: string[];
  min_salience?: number;
}

/** Options for resolving output trees. */
export interface OutputRequest {
  path?: string;
  depth?: number;
  filter?: SubscriptionFilter;
  window?: [number, number];
}

export abstract class ProviderBase<S = unknown> {
  protected options: SlopClientOptions<S>;
  protected currentTree: SlopNode = { id: "root", type: "root" };
  protected currentHandlers = new Map<string, ActionHandler>();
  protected version = 0;

  constructor(options: SlopClientOptions<S>) {
    this.options = options;
  }

  /** Current tree version. */
  getVersion(): number {
    return this.version;
  }

  /** Current tree (raw, before output filtering). */
  getTree(): SlopNode {
    return this.currentTree;
  }

  // --- Subclass hooks ---

  /**
   * Return all descriptors to assemble the tree from.
   * Called during rebuild(). The client returns static registrations;
   * the server evaluates descriptor functions too.
   */
  protected abstract getRegistrations(): Map<string, NodeDescriptor>;

  /**
   * Called after a successful rebuild with changes.
   * Receives the diff ops so implementations can send `patch` messages.
   * The client pushes to a single transport; the server pushes
   * to all subscribed connections.
   */
  protected abstract broadcast(ops: PatchOp[]): void;

  // --- Shared logic ---

  /** Rebuild the tree from registrations, diff, and broadcast if changed. */
  protected rebuild(): void {
    const registrations = this.getRegistrations();
    const { tree, handlers } = assembleTree(
      registrations,
      this.options.id,
      this.options.name,
    );
    const ops = diffNodes(this.currentTree, tree);
    this.currentHandlers = handlers;

    if (ops.length > 0) {
      this.currentTree = tree;
      this.version++;
      this.broadcast(ops);
    } else if (this.version === 0) {
      this.currentTree = tree;
      this.version = 1;
    }
  }

  /** Resolve an action handler by path + action name. */
  resolveHandler(path: string, action: string): ActionHandler | undefined {
    const rootPrefix = `/${this.options.id}/`;
    let cleanPath = path;
    if (cleanPath.startsWith(rootPrefix)) {
      cleanPath = cleanPath.slice(rootPrefix.length);
    } else if (cleanPath.startsWith("/")) {
      cleanPath = cleanPath.slice(1);
    }

    const key = cleanPath ? `${cleanPath}/${action}` : action;
    return this.currentHandlers.get(key);
  }

  /**
   * Execute an invoke and return the result message to send.
   * Also triggers a rebuild (auto-refresh after invoke).
   */
  async executeInvoke(msg: {
    id: string;
    path: string;
    action: string;
    params?: Record<string, unknown>;
  }): Promise<any> {
    const handler = this.resolveHandler(msg.path, msg.action);
    if (!handler) {
      return {
        type: "result",
        id: msg.id,
        status: "error",
        error: {
          code: "not_found",
          message: `No handler for ${msg.action} at ${msg.path}`,
        },
      };
    }

    try {
      const data = await handler(msg.params ?? {});
      const isAsync = data && typeof data === "object" && (data as any).__async === true;
      const { __async, ...resultData } = (data as any) ?? {};
      const result: any = {
        type: "result",
        id: msg.id,
        status: isAsync ? "accepted" : "ok",
      };
      if (Object.keys(resultData).length > 0) {
        result.data = resultData;
      }
      // Auto-refresh
      this.rebuild();
      return result;
    } catch (err: any) {
      return {
        type: "result",
        id: msg.id,
        status: "error",
        error: {
          code: err.code ?? "internal",
          message: err.message ?? String(err),
        },
      };
    }
  }

  /** Build the hello message for a new connection. */
  helloMessage(): any {
    return {
      type: "hello",
      provider: {
        id: this.options.id,
        name: this.options.name,
        slop_version: "0.1",
        capabilities: ["state", "patches", "affordances", "attention", "windowing", "async", "content_refs"],
      },
    };
  }

  /** Prepare the tree for output, applying path, depth, filter, window, and global options. */
  getOutputTree(request?: OutputRequest): SlopNode {
    let tree = request?.path
      ? getSubtree(this.currentTree, request.path) ?? this.currentTree
      : this.currentTree;

    tree = prepareTree(tree, {
      maxDepth: request?.depth != null && request.depth >= 0
        ? request.depth
        : this.options.maxDepth,
      maxNodes: this.options.maxNodes,
      minSalience: request?.filter?.min_salience,
      types: request?.filter?.types,
    });

    // Apply windowing if requested
    if (request?.window && tree.children) {
      const [offset, count] = request.window;
      const totalChildren = tree.children.length;
      const sliced = tree.children.slice(offset, offset + count);
      tree = {
        ...tree,
        children: sliced,
        meta: {
          ...tree.meta,
          window: [offset, count],
          total_children: totalChildren,
        },
      };
    }

    return tree;
  }

  /** Build a snapshot message for a given request. */
  snapshotMessage(id: string, request?: OutputRequest): any {
    return {
      type: "snapshot",
      id,
      version: this.version,
      tree: this.getOutputTree(request),
    };
  }
}
