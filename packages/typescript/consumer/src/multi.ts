import type {
  ClientTransport, SlopNode, ResultMessage,
} from "./types";
import { SlopConsumer } from "./consumer";
import { Emitter } from "./emitter";

interface ProviderEntry {
  name: string;
  consumer: SlopConsumer;
  subscriptionId: string | null;
  tree: SlopNode | null;
}

/**
 * Multi-provider consumer that subscribes to multiple SLOP providers,
 * merges their trees into one unified view, and routes invokes to the
 * correct provider.
 *
 * ```ts
 * const multi = new SlopMultiConsumer();
 * await multi.add("data", new WebSocketClientTransport("ws://localhost:3000/slop"));
 * await multi.add("ui", new PostMessageClientTransport(port));
 *
 * const tree = multi.tree(); // merged tree from both providers
 * const tools = affordancesToTools(tree); // all affordances from both
 *
 * // Invoke routes to the correct provider automatically
 * await multi.invoke("/data/todos/todo-1", "toggle");
 * await multi.invoke("/ui/filters", "set_filter", { category: "work" });
 * ```
 */
export class SlopMultiConsumer extends Emitter {
  private providers = new Map<string, ProviderEntry>();

  /**
   * Add a provider by name. Connects and subscribes to the root tree.
   *
   * @param name - Provider name (used as subtree prefix in the merged tree)
   * @param transport - Transport to connect with
   * @param path - Subscription path (default: "/")
   * @param depth - Subscription depth (default: -1 for full tree)
   */
  async add(
    name: string,
    transport: ClientTransport,
    path = "/",
    depth = -1
  ): Promise<void> {
    const consumer = new SlopConsumer(transport);
    await consumer.connect();

    const { id, snapshot } = await consumer.subscribe(path, depth);

    const entry: ProviderEntry = {
      name,
      consumer,
      subscriptionId: id,
      tree: snapshot,
    };
    this.providers.set(name, entry);

    // Listen for updates and rebuild merged tree
    consumer.on("patch", (subId: string) => {
      if (subId === entry.subscriptionId) {
        entry.tree = consumer.getTree(subId);
        this.emit("change", name);
      }
    });

    consumer.on("disconnect", () => {
      this.emit("disconnect", name);
    });
  }

  /**
   * Remove a provider and disconnect.
   */
  remove(name: string): void {
    const entry = this.providers.get(name);
    if (!entry) return;
    if (entry.subscriptionId) {
      entry.consumer.unsubscribe(entry.subscriptionId);
    }
    entry.consumer.disconnect();
    this.providers.delete(name);
  }

  /**
   * Get the merged tree from all providers.
   * Each provider's tree becomes a child of the root, named by the provider name.
   */
  tree(): SlopNode {
    const children: SlopNode[] = [];

    for (const [name, entry] of this.providers) {
      if (entry.tree) {
        // Wrap each provider's tree as a named subtree
        children.push({
          ...entry.tree,
          id: name,
        });
      }
    }

    return {
      id: "root",
      type: "root",
      children: children.length > 0 ? children : undefined,
    };
  }

  /**
   * Get a single provider's tree (unmerged).
   */
  providerTree(name: string): SlopNode | null {
    return this.providers.get(name)?.tree ?? null;
  }

  /**
   * Invoke an action. Automatically routes to the correct provider
   * based on the first path segment matching a provider name.
   *
   * Path format: `"/providerName/rest/of/path"` → routes to `providerName`
   * with path `"/rest/of/path"`.
   */
  async invoke(
    path: string,
    action: string,
    params?: Record<string, unknown>
  ): Promise<ResultMessage> {
    const { providerName, innerPath } = this.routePath(path);
    const entry = this.providers.get(providerName);
    if (!entry) {
      return {
        type: "result",
        id: "",
        status: "error",
        error: { code: "not_found", message: `No provider named '${providerName}'` },
      } as any;
    }
    return entry.consumer.invoke(innerPath, action, params);
  }

  /**
   * Invoke an action and then trigger a refresh on another provider.
   * Useful for data invalidation: invoke on data provider, then refresh UI.
   */
  async invokeAndRefresh(
    path: string,
    action: string,
    params: Record<string, unknown> | undefined,
    refreshProvider: string,
    refreshPath: string,
    refreshAction = "refresh"
  ): Promise<ResultMessage> {
    const result = await this.invoke(path, action, params);
    if (result.status !== "error") {
      await this.invoke(refreshPath, refreshAction);
    }
    return result;
  }

  /**
   * Disconnect all providers.
   */
  disconnect(): void {
    for (const [name] of this.providers) {
      this.remove(name);
    }
  }

  /**
   * Get the list of connected provider names.
   */
  providerNames(): string[] {
    return [...this.providers.keys()];
  }

  private routePath(path: string): { providerName: string; innerPath: string } {
    // Strip leading slash
    const clean = path.startsWith("/") ? path.slice(1) : path;
    const slashIdx = clean.indexOf("/");

    if (slashIdx === -1) {
      // Path is just the provider name — action is on the provider's root
      return { providerName: clean, innerPath: "/" };
    }

    const providerName = clean.slice(0, slashIdx);
    const innerPath = "/" + clean.slice(slashIdx + 1);

    // If the first segment isn't a known provider, try using it as-is
    if (!this.providers.has(providerName)) {
      // Fall back: try the full path against each provider
      for (const [name] of this.providers) {
        return { providerName: name, innerPath: path };
      }
    }

    return { providerName, innerPath };
  }
}
