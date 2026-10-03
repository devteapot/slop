// Browser-safe entry point — excludes Node.js transports

import { SlopConsumer as SlopConsumerImpl } from "./consumer";
import { Emitter as EmitterImpl } from "./emitter";
import { StateMirror as StateMirrorImpl } from "./state-mirror";
import {
  composeMessagesWithSlopState as composeMessagesWithSlopStateImpl,
  escapeSlopContextTags as escapeSlopContextTagsImpl,
  renderSlopAvailableApps as renderSlopAvailableAppsImpl,
  renderSlopStateTail as renderSlopStateTailImpl,
  stripSlopContextBlocks as stripSlopContextBlocksImpl,
} from "./llm-context";
import { affordancesToTools as affordancesToToolsImpl, formatTree as formatTreeImpl } from "./tools";
import { PostMessageClientTransport as PostMessageClientTransportImpl } from "./transport-pm";
import { WebSocketClientTransport as WebSocketClientTransportImpl } from "./transport-ws";

// Consumer
export const SlopConsumer = SlopConsumerImpl;
export const StateMirror = StateMirrorImpl;
export type SlopConsumer = InstanceType<typeof SlopConsumerImpl>;
export type StateMirror = InstanceType<typeof StateMirrorImpl>;

// Browser transports only
export const WebSocketClientTransport = WebSocketClientTransportImpl;
export const PostMessageClientTransport = PostMessageClientTransportImpl;
export type WebSocketClientTransport = InstanceType<typeof WebSocketClientTransportImpl>;
export type PostMessageClientTransport = InstanceType<typeof PostMessageClientTransportImpl>;

// LLM tool utilities
export const affordancesToTools = affordancesToToolsImpl;
export const formatTree = formatTreeImpl;
export type { ChatMessage, LlmTool, ToolSet } from "./tools";

// LLM context tail
export const renderSlopStateTail = renderSlopStateTailImpl;
export const renderSlopAvailableApps = renderSlopAvailableAppsImpl;
export const stripSlopContextBlocks = stripSlopContextBlocksImpl;
export const composeMessagesWithSlopState = composeMessagesWithSlopStateImpl;
export const escapeSlopContextTags = escapeSlopContextTagsImpl;
export type {
  AvailableSlopApp,
  ComposableMessage,
  ComposeMessagesOptions,
  ContentBlock,
  RenderAvailableAppsInput,
  RenderSlopStateInput,
  RenderSlopStateOptions,
  SlopStateApp,
  SlopStatePlacement,
  TextContentBlock,
} from "./llm-context";

// Emitter
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
