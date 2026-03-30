import { useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { SlopUIAdapter } from "./adapter";
import type { NodeDescriptor } from "@slop-ai/core";

// Singleton adapter — persists across navigations
let globalAdapter: SlopUIAdapter | null = null;
// Track pending registrations from useSlop calls that happen before the adapter is ready
let pendingRegistrations: Array<{ path: string; descriptor: NodeDescriptor }> = [];

/**
 * Initialize the SLOP UI adapter. Call once per page (in the page component).
 * Establishes the bidirectional WebSocket connection to the server.
 *
 * When the server state changes (via SLOP invoke or refresh), the adapter
 * receives a `data_changed` signal and automatically calls `router.invalidate()`
 * to re-fetch loader data.
 *
 * @param wsPath - WebSocket path (default: "/slop")
 */
export function useSlopUI(wsPath: string = "/slop"): void {
  const router = useRouter();

  useEffect(() => {
    if (!globalAdapter) {
      globalAdapter = new SlopUIAdapter();
      globalAdapter.connect(wsPath, () => {
        router.invalidate();
      });

      // Flush any registrations that happened before the adapter was ready
      for (const { path, descriptor } of pendingRegistrations) {
        globalAdapter.register(path, descriptor);
      }
      pendingRegistrations = [];
    }

    return () => {};
  }, [wsPath]);

  // Auto-register route node with navigation — updates on every navigation
  const pathname = router.state.location.pathname;
  const params = router.state.matches?.at(-1)?.params;

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
    if (globalAdapter) {
      globalAdapter.register("route", {
        type: "status",
        props: {
          path: pathname,
          ...(params && Object.keys(params).length > 0 ? { params } : {}),
          availableRoutes: availableRoutes.current,
        },
        actions: {
          ui_navigate: {
            label: "Navigate to a page",
            params: { path: "string" },
            handler: (p: any) => {
              router.navigate({ to: p.path });
            },
          },
          ui_back: {
            label: "Go back",
            handler: () => {
              router.history.back();
            },
          },
        },
      });
    }
  }, [pathname]);
}

/**
 * Register UI state with SLOP. The descriptor is sent to the server (under ui/ prefix)
 * and the action handlers are kept locally for invoke forwarding.
 *
 * ```tsx
 * useSlop("filters", {
 *   type: "status",
 *   props: { category: filter },
 *   actions: {
 *     ui_set_filter: {
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
    if (globalAdapter) {
      globalAdapter.register(path, descriptorRef.current);
    } else {
      pendingRegistrations.push({ path, descriptor: descriptorRef.current });
    }

    return () => {
      globalAdapter?.unregister(path);
      pendingRegistrations = pendingRegistrations.filter(p => p.path !== path);
    };
  }, [path]);

  // Re-register on every render to keep handlers fresh
  useEffect(() => {
    if (globalAdapter) {
      globalAdapter.register(path, descriptorRef.current);
    }
  });
}
