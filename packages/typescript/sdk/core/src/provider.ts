/**
 * Shared provider logic used by both the client (in-browser) and server
 * (multi-connection) packages. Handles registrations, tree assembly,
 * diffing, handler resolution, invoke dispatch, and output tree generation.
 *
 * Subclasses override `getRegistrations()` to supply descriptors and
 * `broadcast()` to push updates to consumers.
 */

import { diffNodes } from "./diff";
import { getSubtree, prepareTree } from "./scaling";
import { assembleTree } from "./tree-assembler";
import type { ActionHandler, Affordance, NodeDescriptor, PatchOp, SlopClientOptions, SlopNode } from "./types";
import { AsyncActionResult } from "./types";
import { validateParams } from "./validate-params";

/** Subscription filter from a consumer's subscribe message. */
export interface SubscriptionFilter {
  types?: string[];
  min_salience?: number;
}

/** Thrown when a subscribe/query references a path that does not exist in the current tree. */
export class SubtreeNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`Path ${path} not found`);
    this.name = "SubtreeNotFoundError";
  }
}

/** Options for resolving output trees. */
export interface OutputRequest {
  path?: string;
  depth?: number;
  max_nodes?: number;
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
    const { tree, handlers } = assembleTree(registrations, this.options.id, this.options.name);
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

  /** Look up the affordance descriptor for a path+action in the current tree. */
  resolveAffordance(path: string, action: string): Affordance | undefined {
    const rootPrefix = `/${this.options.id}`;
    let treePath = path;
    if (treePath === rootPrefix) treePath = "/";
    else if (treePath.startsWith(`${rootPrefix}/`)) treePath = treePath.slice(rootPrefix.length);
    const node = treePath === "/" ? this.currentTree : getSubtree(this.currentTree, treePath);
    return node?.affordances?.find((a) => a.action === action);
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
  }): Promise<Record<string, unknown>> {
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

    // Spec: providers MUST validate invoke params against the affordance's
    // declared schema before running the handler. The handler can still
    // enforce richer invariants, but we catch shape mismatches here so the
    // invalid_params code is reliable across SDKs.
    const affordance = this.resolveAffordance(msg.path, msg.action);
    if (affordance?.params) {
      const err = validateParams(affordance.params, msg.params ?? {});
      if (err) {
        return {
          type: "result",
          id: msg.id,
          status: "error",
          error: { code: "invalid_params", message: err },
        };
      }
    }

    try {
      const data = await handler(msg.params ?? {});
      // Two equivalent async-action conventions per spec/extensions/async-actions.md:
      // (1) return an AsyncActionResult instance (idiomatic TS), or
      // (2) return a plain object with { __async: true, taskId, ... } (wire-level,
      //     shared with the Python/Go/Rust SDKs).
      const isAsyncInstance = data instanceof AsyncActionResult;
      const isAsyncDict =
        !isAsyncInstance &&
        data !== null &&
        typeof data === "object" &&
        (data as Record<string, unknown>).__async === true;
      const isAsync = isAsyncInstance || isAsyncDict;

      let resultData: Record<string, unknown>;
      if (isAsyncInstance) {
        resultData = { taskId: data.taskId, ...(data.data ?? {}) };
      } else if (isAsyncDict) {
        // Strip the marker; everything else (including taskId) is passed through.
        const { __async: _discard, ...rest } = data as Record<string, unknown>;
        resultData = rest;
      } else {
        resultData = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
      }

      const result: Record<string, unknown> = {
        type: "result",
        id: msg.id,
        status: isAsync ? "accepted" : "ok",
      };
      if (isAsync || Object.keys(resultData).length > 0) {
        result.data = resultData;
      }
      // Auto-refresh
      this.rebuild();
      return result;
    } catch (err: any) {
      // A handler may mutate state before failing; those changes MUST still be
      // broadcast before the error result (spec/core/messages.md §Message ordering).
      this.rebuild();
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
  helloMessage(): Record<string, unknown> {
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

  /**
   * Prepare the tree for output, applying path, depth, filter, window, and global options.
   *
   * Throws `SubtreeNotFoundError` when `request.path` is set and does not resolve
   * to a node — callers MUST translate this into a `not_found` error response
   * rather than silently returning the root tree.
   */
  getOutputTree(request?: OutputRequest): SlopNode {
    let tree: SlopNode;
    if (request?.path && request.path !== "/") {
      const sub = getSubtree(this.currentTree, request.path);
      if (!sub) throw new SubtreeNotFoundError(request.path);
      tree = sub;
    } else {
      tree = this.currentTree;
    }

    tree = prepareTree(tree, {
      maxDepth: request?.depth != null && request.depth >= 0 ? request.depth : this.options.maxDepth,
      maxNodes:
        request?.max_nodes != null && this.options.maxNodes != null
          ? Math.min(request.max_nodes, this.options.maxNodes)
          : (request?.max_nodes ?? this.options.maxNodes),
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
  snapshotMessage(id: string, request?: OutputRequest): Record<string, unknown> {
    return {
      type: "snapshot",
      id,
      version: this.version,
      tree: this.getOutputTree(request),
    };
  }
}
