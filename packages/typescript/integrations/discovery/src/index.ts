import { createDiscoveryService as createDiscoveryServiceImpl } from "./discovery";
import { createBridgeClient as createBridgeClientImpl } from "./bridge-client";
import { createBridgeServer as createBridgeServerImpl } from "./bridge-server";
import { BridgeRelayTransport as BridgeRelayTransportImpl } from "./relay-transport";
import { createToolHandlers as createToolHandlersImpl, createDynamicTools as createDynamicToolsImpl } from "./tools";
import { createStateCache as createStateCacheImpl } from "./state-cache";

export const createDiscoveryService = createDiscoveryServiceImpl;
export type {
  DiscoveryService,
  DiscoveryOptions,
  ProviderDescriptor,
  ConnectedProvider,
} from "./discovery";
export const createBridgeClient = createBridgeClientImpl;
export type {
  Bridge,
  BridgeProvider,
  RelayHandler,
  BridgeClientOptions,
} from "./bridge-client";
export const createBridgeServer = createBridgeServerImpl;
export type { BridgeServerOptions } from "./bridge-server";
export const BridgeRelayTransport = BridgeRelayTransportImpl;

/** Agent-agnostic tool handlers and dynamic affordance→tool mapping (OpenClaw, MCP bridges, etc.). */
export const createToolHandlers = createToolHandlersImpl;
export const createDynamicTools = createDynamicToolsImpl;
export type {
  ToolResult,
  DynamicToolSet,
  DynamicToolEntry,
} from "./tools";
export const createStateCache = createStateCacheImpl;
export type { StateCache } from "./state-cache";
