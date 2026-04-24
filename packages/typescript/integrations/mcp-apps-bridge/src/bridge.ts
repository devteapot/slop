import { App } from "@modelcontextprotocol/ext-apps";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import {
  type ClientTransport,
  type ResultMessage,
  SlopConsumer,
  type SlopNode,
  WebSocketClientTransport,
} from "@slop-ai/consumer/browser";
import { createProjector, type ProjectionOptions } from "./projection";
import { SameWindowPostMessageTransport } from "./transport-pm";

export type ProviderConfig =
  | { mode: "ws"; url: string }
  | { mode: "postmessage"; targetWindow?: Window; origin?: string };

export interface SubscribeConfig {
  path?: string;
  depth?: number;
  minSalience?: number;
  types?: string[];
  maxNodes?: number;
}

export interface McpAppsBridgeOptions {
  /** How the iframe reaches the SLOP provider. */
  provider: ProviderConfig;
  /** What subtree to mirror into the host model's context. */
  subscribe?: SubscribeConfig;
  /** Projection strategy — defaults to salience-filtered markdown, 250ms debounce. */
  projection?: ProjectionOptions;
  /** App metadata advertised to the MCP host during ui/initialize. */
  appInfo?: Implementation;
}

export interface McpAppsBridge {
  app: App;
  consumer: SlopConsumer;
  subscriptionId: string;
  invoke(path: string, action: string, params?: Record<string, unknown>): Promise<ResultMessage>;
  getTree(): SlopNode | null;
  /** Force-flush any pending projection update. */
  flush(): void;
  dispose(): void;
}

function buildTransport(cfg: ProviderConfig): ClientTransport {
  if (cfg.mode === "ws") {
    return new WebSocketClientTransport(cfg.url);
  }
  return new SameWindowPostMessageTransport({
    targetWindow: cfg.targetWindow,
    origin: cfg.origin,
  });
}

/**
 * Boot a SLOP session inside an MCP Apps iframe.
 *
 * - Instantiates an ext-apps `App` and connects it over the default postMessage transport.
 * - Opens a `SlopConsumer` against the configured provider (WebSocket or same-window postMessage).
 * - Subscribes with the requested salience/depth filter.
 * - Pushes salience-filtered markdown projections of the state tree into `app.updateModelContext`
 *   on every snapshot or patch, debounced to avoid flooding the host.
 */
export async function createMcpAppsBridge(options: McpAppsBridgeOptions): Promise<McpAppsBridge> {
  const appInfo: Implementation = options.appInfo ?? {
    name: "slop-bridge",
    version: "0.1.0",
  };

  const app = new App(appInfo, {});
  const transport = buildTransport(options.provider);
  const consumer = new SlopConsumer(transport);

  // Track init state for partial-failure cleanup. Promise.all rejects as
  // soon as one side fails, but the other connect promise may resolve
  // *after* we've thrown — leaking its WebSocket or postMessage listeners.
  // We use a shared `failed` flag so a late-successful connect immediately
  // tears its own side down instead of waiting for the catch handler.
  let failed = false;
  let consumerConnected = false;
  let appConnected = false;

  const consumerPromise = consumer.connect().then(
    () => {
      if (failed) {
        consumer.disconnect();
        return;
      }
      consumerConnected = true;
    },
    (err) => {
      failed = true;
      throw err;
    },
  );
  const appPromise = app.connect().then(
    () => {
      if (failed) {
        void app.close().catch(() => {});
        return;
      }
      appConnected = true;
    },
    (err) => {
      failed = true;
      throw err;
    },
  );

  let subscriptionId: string;
  try {
    await Promise.all([consumerPromise, appPromise]);

    const subCfg = options.subscribe ?? {};
    const sub = await consumer.subscribe(subCfg.path ?? "/", subCfg.depth ?? 1, {
      ...(subCfg.maxNodes != null && { max_nodes: subCfg.maxNodes }),
      ...((subCfg.minSalience != null || subCfg.types) && {
        filter: {
          ...(subCfg.minSalience != null && { min_salience: subCfg.minSalience }),
          ...(subCfg.types && { types: subCfg.types }),
        },
      }),
    });
    subscriptionId = sub.id;
  } catch (err) {
    failed = true;
    if (consumerConnected) consumer.disconnect();
    if (appConnected) void app.close().catch(() => {});
    throw err;
  }

  const projector = createProjector((text) => {
    // Fire-and-forget: the host may reject updates before hello completes,
    // which we treat as non-fatal and just drop.
    app.updateModelContext({ content: [{ type: "text", text }] }).catch(() => {});
  }, options.projection ?? {});

  // Initial projection from the snapshot.
  const initial = consumer.getTree(subscriptionId);
  if (initial) projector.schedule(initial);

  // Re-project on every patch (consumer already mirrored the tree).
  const onPatch = (subId: string) => {
    if (subId !== subscriptionId) return;
    const tree = consumer.getTree(subscriptionId);
    if (tree) projector.schedule(tree);
  };
  consumer.on("patch", onPatch);

  let disposed = false;

  return {
    app,
    consumer,
    subscriptionId,
    invoke: (path, action, params) => consumer.invoke(path, action, params),
    getTree: () => consumer.getTree(subscriptionId),
    flush: () => projector.flush(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      projector.dispose();
      consumer.off("patch", onPatch);
      consumer.unsubscribe(subscriptionId);
      consumer.disconnect();
      // Close the ext-apps Protocol so postMessage listeners detach cleanly —
      // matters in long-lived iframes/SPAs where dispose can be called many times.
      void app.close().catch(() => {});
    },
  };
}
