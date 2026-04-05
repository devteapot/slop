// Consumer
export { SlopConsumer } from "./consumer";
export { StateMirror } from "./state-mirror";

// Transports
export { WebSocketClientTransport } from "./transport-ws";
export { PostMessageClientTransport } from "./transport-pm";
export { NodeSocketClientTransport } from "./transport-node-socket";

// LLM tool utilities
export {
  affordancesToTools,
  formatTree,
  type LlmTool,
  type ToolSet,
  type ChatMessage,
} from "./tools";

// Emitter (for custom transports)
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
