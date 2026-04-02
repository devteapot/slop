// Provider base (shared between client and server)
export { ProviderBase } from "./provider";
export type { SubscriptionFilter, OutputRequest } from "./provider";

// Async action result marker
export { AsyncActionResult } from "./types";

// Re-export types
export type {
  SlopClient,
  SlopClientOptions,
  NodeDescriptor,
  ItemDescriptor,
  Action,
  ActionHandler,
  ParamDef,
  SlopNode,
  Affordance,
  NodeMeta,
  JsonSchema,
  PatchOp,
  ContentRef,
  WindowDescriptor,
  TaskHandle,
  InferParams,
} from "./types";

// Transport interface
export type { Transport } from "./transport";

// Re-export schema types
export type { ExtractPaths, ExtractSubSchema } from "./schema-types";

// Re-export helpers
export { pick, omit, action } from "./helpers";

// Re-export internals for advanced use
export { assembleTree } from "./tree-assembler";
export { diffNodes } from "./diff";

// Scaling utilities
export {
  prepareTree,
  getSubtree,
  truncateTree,
  autoCompact,
  filterTree,
  countNodes,
} from "./scaling";
export type { OutputTreeOptions } from "./scaling";
