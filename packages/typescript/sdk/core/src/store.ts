import type { NodeDescriptor } from "./types";

export type StoreUnsubscribe = () => void;

export interface StoreSubscription {
  unsubscribe(): void;
}

export type StoreSubscribeResult = StoreUnsubscribe | StoreSubscription;

export interface StateStore<S> {
  getState(): S;
  subscribe(listener: () => void): StoreSubscribeResult;
}

export interface StoreTarget {
  register(path: string, descriptor: NodeDescriptor): void;
  unregister(path: string, opts?: { recursive?: boolean }): void;
}

export type StorePath<S> = string | ((state: S) => string);

export interface ExposeStoreOptions<S> {
  /**
   * Skip re-registering when the store emits but the selected state is
   * equivalent for this SLOP projection.
   */
  equals?: (previous: S, next: S) => boolean;
  /**
   * Debounce store emissions before recomputing the descriptor. The SLOP
   * client still batches tree rebuilds; this controls projection work.
   */
  debounceMs?: number;
}

/**
 * Bind a generic state store to a SLOP node.
 *
 * The store supplies change notifications; the projection decides what
 * semantic state and affordances to expose. This works with Zustand, Redux,
 * and any other store that has `getState()` plus `subscribe()`.
 */
export function exposeStore<S>(
  target: StoreTarget,
  path: StorePath<S>,
  store: StateStore<S>,
  project: (state: S) => NodeDescriptor,
  options: ExposeStoreOptions<S> = {},
): StoreUnsubscribe {
  let currentPath: string | undefined;
  let previousState: S | undefined;
  let hasPreviousState = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const update = () => {
    if (disposed) return;

    const state = store.getState();
    if (hasPreviousState && options.equals?.(previousState as S, state)) {
      return;
    }

    const nextPath = resolveStorePath(path, state);
    if (currentPath && currentPath !== nextPath) {
      target.unregister(currentPath, { recursive: true });
    }

    target.register(nextPath, project(state));
    currentPath = nextPath;
    previousState = state;
    hasPreviousState = true;
  };

  const scheduleUpdate = () => {
    if (disposed) return;

    const debounceMs = options.debounceMs ?? 0;
    if (debounceMs <= 0) {
      update();
      return;
    }

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      update();
    }, debounceMs);
  };

  update();

  const subscription = store.subscribe(scheduleUpdate);

  return () => {
    disposed = true;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    disposeStoreSubscription(subscription);
    if (currentPath) {
      target.unregister(currentPath, { recursive: true });
      currentPath = undefined;
    }
  };
}

function resolveStorePath<S>(path: StorePath<S>, state: S): string {
  return typeof path === "function" ? path(state) : path;
}

function disposeStoreSubscription(subscription: StoreSubscribeResult): void {
  if (typeof subscription === "function") {
    subscription();
    return;
  }
  subscription.unsubscribe();
}
