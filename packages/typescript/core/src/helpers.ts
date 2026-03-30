import type { Action, ActionHandler, ParamDef, InferParams } from "./types";

/** Pick specific fields from an object for use in props */
export function pick<T extends Record<string, any>, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) result[key] = obj[key];
  }
  return result;
}

/** Exclude specific fields from an object for use in props */
export function omit<T extends Record<string, any>, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) delete (result as any)[key];
  return result as Omit<T, K>;
}

/** Create a typed action with params inferred from the declaration */
export function action<P extends Record<string, ParamDef>>(
  params: P,
  handler: (params: InferParams<P>) => unknown | Promise<unknown>,
  options?: { label?: string; description?: string; dangerous?: boolean; idempotent?: boolean; estimate?: "instant" | "fast" | "slow" | "async" }
): Action;

/** Create an action with options (no params) */
export function action(
  handler: ActionHandler,
  options: { label?: string; description?: string; dangerous?: boolean; idempotent?: boolean; estimate?: "instant" | "fast" | "slow" | "async" }
): Action;

export function action(...args: any[]): Action {
  if (typeof args[0] === "function") {
    // action(handler, options)
    return { handler: args[0], ...args[1] };
  }
  // action(params, handler, options?)
  const [params, handler, options] = args;
  return { params, handler, ...options };
}
