export {
  createDiscoveryService,
  type DiscoveryService,
  type DiscoveryOptions,
  type ProviderDescriptor,
  type ConnectedProvider,
} from "./discovery";
export {
  type Bridge,
  type BridgeProvider,
  type RelayHandler,
  type BridgeClientOptions,
  createBridgeClient,
} from "./bridge-client";
export { createBridgeServer, type BridgeServerOptions } from "./bridge-server";
export { BridgeRelayTransport } from "./relay-transport";

/** Agent-agnostic tool handlers and dynamic affordance→tool mapping (OpenClaw, MCP bridges, etc.). */
export {
  createToolHandlers,
  createDynamicTools,
  type ToolResult,
  type DynamicToolSet,
  type DynamicToolEntry,
} from "./tools";
export { createStateCache, type StateCache } from "./state-cache";
