// Browser-safe entry point — excludes Node.js transports

// Consumer
export { SlopConsumer } from "./consumer";
export { StateMirror } from "./state-mirror";

// Browser transports only
export { WebSocketClientTransport } from "./transport-ws";
export { PostMessageClientTransport } from "./transport-pm";

// LLM tool utilities
export {
  affordancesToTools,
  formatTree,
  type LlmTool,
  type ToolSet,
  type ChatMessage,
} from "./tools";

// Emitter
export { Emitter } from "./emitter";

// Types
export type {
  SlopNode,
  NodeMeta,
  Affordance,
  JsonSchema,
  PatchOp,
  SlopMessage,
  ConsumerMessage,
  ProviderMessage,
  HelloMessage,
  SnapshotMessage,
  PatchMessage,
  ResultMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  QueryMessage,
  InvokeMessage,
  Connection,
  ClientTransport,
  MessageHandler,
} from "./types";
