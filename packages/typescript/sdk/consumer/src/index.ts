import { SlopConsumer as SlopConsumerImpl } from "./consumer";
import { Emitter as EmitterImpl } from "./emitter";
import { StateMirror as StateMirrorImpl } from "./state-mirror";
import { affordancesToTools as affordancesToToolsImpl, formatTree as formatTreeImpl } from "./tools";
import { NodeSocketClientTransport as NodeSocketClientTransportImpl } from "./transport-node-socket";
import { PostMessageClientTransport as PostMessageClientTransportImpl } from "./transport-pm";
import { WebSocketClientTransport as WebSocketClientTransportImpl } from "./transport-ws";

// Consumer
export const SlopConsumer = SlopConsumerImpl;
export const StateMirror = StateMirrorImpl;
export type SlopConsumer = InstanceType<typeof SlopConsumerImpl>;
export type StateMirror = InstanceType<typeof StateMirrorImpl>;

// Transports
export const WebSocketClientTransport = WebSocketClientTransportImpl;
export const PostMessageClientTransport = PostMessageClientTransportImpl;
export const NodeSocketClientTransport = NodeSocketClientTransportImpl;
export type WebSocketClientTransport = InstanceType<typeof WebSocketClientTransportImpl>;
export type PostMessageClientTransport = InstanceType<typeof PostMessageClientTransportImpl>;
export type NodeSocketClientTransport = InstanceType<typeof NodeSocketClientTransportImpl>;

// LLM tool utilities
export const affordancesToTools = affordancesToToolsImpl;
export const formatTree = formatTreeImpl;
export type { ChatMessage, LlmTool, ToolSet } from "./tools";

// Emitter (for custom transports)
export const Emitter = EmitterImpl;
export type Emitter = InstanceType<typeof EmitterImpl>;

// Types
export type {
  Affordance,
  ClientTransport,
  Connection,
  ConsumerMessage,
  HelloMessage,
  InvokeMessage,
  JsonSchema,
  MessageHandler,
  NodeMeta,
  PatchMessage,
  PatchOp,
  ProviderMessage,
  QueryMessage,
  ResultMessage,
  SlopMessage,
  SlopNode,
  SnapshotMessage,
  SubscribeMessage,
  UnsubscribeMessage,
} from "./types";
