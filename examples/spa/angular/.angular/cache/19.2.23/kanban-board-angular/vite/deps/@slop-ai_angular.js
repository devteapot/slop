import {
  DestroyRef,
  effect,
  inject
} from "./chunk-W5JWMB5C.js";
import "./chunk-GOMI4DH3.js";

// ../../../packages/typescript/angular/dist/index.js
function useSlop(client, path, descriptor) {
  let currentPath = resolvePath(path);
  effect(() => {
    const p = resolvePath(path);
    const desc = descriptor();
    if (p !== currentPath) {
      client.unregister(currentPath);
      currentPath = p;
    }
    client.register(currentPath, deepUnwrap(desc));
  });
  inject(DestroyRef).onDestroy(() => {
    client.unregister(currentPath);
  });
}
function resolvePath(path) {
  return typeof path === "function" ? path() : path;
}
function deepUnwrap(obj) {
  if (obj == null || typeof obj !== "object") return obj;
  if (typeof obj === "function") return obj;
  if (Array.isArray(obj)) return obj.map(deepUnwrap);
  const out = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    out[key] = typeof val === "function" ? val : deepUnwrap(val);
  }
  return out;
}
export {
  useSlop
};
//# sourceMappingURL=@slop-ai_angular.js.map
