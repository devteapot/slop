import { createBridgeClient as createBridgeClientImpl } from "./bridge-client";
import { createBridgeServer as createBridgeServerImpl } from "./bridge-server";
import { BridgeRelayTransport as BridgeRelayTransportImpl } from "./relay-transport";

export type { ProviderDescriptor } from "./discovery";
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
