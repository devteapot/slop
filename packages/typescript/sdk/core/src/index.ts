import { diffNodes } from "./diff";
import { action, omit, pick } from "./helpers";
import { ProviderBase, SubtreeNotFoundError } from "./provider";
import { autoCompact, countNodes, filterTree, getSubtree, prepareTree, truncateTree } from "./scaling";
import { assembleTree } from "./tree-assembler";
import { AsyncActionResult } from "./types";

// Path utilities
export {
  escapeJsonPointerSegment,
  isValidNodeId,
  unescapeJsonPointerSegment,
  validateNodeId,
} from "./paths";
export type { OutputRequest, SubscriptionFilter } from "./provider";
export type { OutputTreeOptions } from "./scaling";
// Re-export schema types
export type { ExtractPaths, ExtractSubSchema } from "./schema-types";
// Transport interface
export type { Transport } from "./transport";
// Re-export types
export type {
  Action,
  ActionHandler,
  Affordance,
  ContentRef,
  InferParams,
  ItemDescriptor,
  JsonSchema,
  NodeDescriptor,
  NodeMeta,
  ParamDef,
  PatchOp,
  SlopClient,
  SlopClientOptions,
  SlopNode,
  TaskHandle,
  WindowDescriptor,
} from "./types";
// Param validator
export { validateParams } from "./validate-params";
// Provider base (shared between client and server)
// Async action result marker
// Re-export helpers
// Re-export internals for advanced use
// Scaling utilities
export {
  AsyncActionResult,
  action,
  assembleTree,
  autoCompact,
  countNodes,
  diffNodes,
  filterTree,
  getSubtree,
  omit,
  ProviderBase,
  pick,
  prepareTree,
  SubtreeNotFoundError,
  truncateTree,
};
