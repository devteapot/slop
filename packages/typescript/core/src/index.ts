import { ProviderBase } from "./provider";
import { AsyncActionResult } from "./types";
import { pick, omit, action } from "./helpers";
import { assembleTree } from "./tree-assembler";
import { diffNodes } from "./diff";
import {
  prepareTree,
  getSubtree,
  truncateTree,
  autoCompact,
  filterTree,
  countNodes,
} from "./scaling";

// Provider base (shared between client and server)
export { ProviderBase };
export type { SubscriptionFilter, OutputRequest } from "./provider";

// Async action result marker
export { AsyncActionResult };

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
export { pick, omit, action };

// Re-export internals for advanced use
export { assembleTree, diffNodes };

// Scaling utilities
export { prepareTree, getSubtree, truncateTree, autoCompact, filterTree, countNodes };
export type { OutputTreeOptions } from "./scaling";
