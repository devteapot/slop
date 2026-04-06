import { SlopConsumer as SlopConsumerImpl } from "./consumer";
import { StateMirror as StateMirrorImpl } from "./state-mirror";
import { WebSocketClientTransport as WebSocketClientTransportImpl } from "./transport-ws";
import { PostMessageClientTransport as PostMessageClientTransportImpl } from "./transport-pm";
import { NodeSocketClientTransport as NodeSocketClientTransportImpl } from "./transport-node-socket";
import { affordancesToTools as affordancesToToolsImpl, formatTree as formatTreeImpl } from "./tools";
import { Emitter as EmitterImpl } from "./emitter";

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
export type { LlmTool, ToolSet, ChatMessage } from "./tools";

// Emitter (for custom transports)
export const Emitter = EmitterImpl;
export type Emitter = InstanceType<typeof EmitterImpl>;

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
