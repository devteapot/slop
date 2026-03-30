// Engine class
export { SlopClientImpl } from "./client";

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
