import { useEffect, useRef } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { createSlop } from "@slop-ai/client";
import type { SlopClient, NodeDescriptor } from "@slop-ai/core";

// Singleton browser-side SLOP provider — persists across navigations
let slopClient: SlopClient | null = null;

/**
 * Initialize the browser-side SLOP provider. Call once per page (in the page component).
 *
 * For TanStack Start apps with a server SLOP endpoint, this opens a hidden
 * browser-to-server WebSocket provider and lets the server mount the current UI
 * under `ui`. If no server endpoint is discoverable, it falls back to the
 * standalone postMessage provider model.
 *
 * Automatically registers a `refresh` affordance that calls
 * `router.invalidate()` so the consumer can trigger data re-fetches after
 * server mutations.
 *
 * Also auto-registers the current route as a `route` node with navigate/back actions.
 *
 * @param appId - App ID for the browser provider (default: "ui")
 * @param appName - Display name (default: "UI")
 */
export function useSlopUI(appId = "ui", appName = "UI"): void {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const params = useRouterState({ select: (s) => s.matches.at(-1)?.params });
  const refreshRef = useRef(() => router.invalidate({ sync: true }));
  refreshRef.current = () => router.invalidate({ sync: true });

  useEffect(() => {
    if (!slopClient) {
      const serverUrl = resolveServerSlopUrl();
      const client = serverUrl
        ? createSlop({
            id: appId,
            name: appName,
            transports: ["websocket"],
            websocketUrl: resolveUiSocketUrl(serverUrl),
            websocketDiscover: false,
          })
        : createSlop({ id: appId, name: appName });
      slopClient = client;

      // Register the refresh affordance — the consumer invokes this
      // after a data action to trigger framework re-fetch
      client.register("__adapter", {
        type: "context",
        actions: {
          refresh: () => refreshRef.current(),
        },
      });

      // Flush any registrations that happened before the client was ready
      for (const { path, descriptor } of pendingRegistrations) {
        client.register(path, descriptor);
      }
      pendingRegistrations = [];
    }

    return () => {};
  }, [appId, appName]);

  // Extract available routes from the router's route tree
  const availableRoutes = useRef<string[]>([]);
  if (availableRoutes.current.length === 0) {
    const routes: string[] = [];
    const walk = (route: any) => {
      if (route.fullPath && route.fullPath !== "/__root__") {
        routes.push(route.fullPath);
      }
      for (const child of route.children ?? []) {
        walk(child);
      }
    };
    walk(router.routeTree);
    availableRoutes.current = [...new Set(routes)];
  }

  useEffect(() => {
    if (slopClient) {
      slopClient.register("route", {
        type: "status",
        props: {
          path: pathname,
          ...(params && Object.keys(params).length > 0 ? { params } : {}),
          availableRoutes: availableRoutes.current,
        },
        actions: {
          navigate: {
            label: "Navigate to a page",
            params: { path: "string" },
            handler: (p: any) => {
              router.navigate({ to: p.path });
            },
          },
          back: {
            label: "Go back",
            handler: () => {
              router.history.back();
            },
          },
        },
      });
    }
  }, [pathname, params, router]);
}

function resolveServerSlopUrl(): string | null {
  if (typeof document === "undefined") return null;

  const metaTags = document.querySelectorAll<HTMLMetaElement>('meta[name="slop"]');
  for (const meta of metaTags) {
    const content = meta.content?.trim();
    if (!content) continue;
    if (content === "postmessage") continue;
    if (content.startsWith("ws://") || content.startsWith("wss://")) {
      return content;
    }
  }

  return null;
}

function resolveUiSocketUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.searchParams.set("slop_role", "provider");
  url.searchParams.set("mount", "ui");
  return url.toString();
}

// Track pending registrations from useSlop calls that happen before useSlopUI
let pendingRegistrations: Array<{ path: string; descriptor: NodeDescriptor }> = [];

/**
 * Register UI state on the browser-side SLOP provider.
 *
 * The descriptor (including action handlers) runs entirely in the browser.
 * In TanStack Start, the UI provider is normally mounted into the app's server
 * provider under `ui`, with a postMessage fallback when no server endpoint is
 * available.
 *
 * ```tsx
 * useSlop("filters", {
 *   type: "status",
 *   props: { category: filter },
 *   actions: {
 *     set_filter: {
 *       params: { category: "string" },
 *       handler: (params) => setFilter(params.category),
 *     },
 *   },
 * });
 * ```
 */
export function useSlop(path: string, descriptor: NodeDescriptor): void {
  const descriptorRef = useRef(descriptor);
  descriptorRef.current = descriptor;

  useEffect(() => {
    if (slopClient) {
      slopClient.register(path, descriptorRef.current);
    } else {
      pendingRegistrations.push({ path, descriptor: descriptorRef.current });
    }

    return () => {
      slopClient?.unregister(path);
      pendingRegistrations = pendingRegistrations.filter(p => p.path !== path);
    };
  }, [path]);

  // Re-register on every render to keep handlers fresh
  useEffect(() => {
    if (slopClient) {
      slopClient.register(path, descriptorRef.current);
    }
  });
}
