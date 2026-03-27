import type { Capability } from "./messages";

export interface TransportDescriptor {
  type: "unix" | "stdio" | "ws";
  path?: string; // for unix
  command?: string[]; // for stdio
  url?: string; // for ws
}

export interface ProviderDescriptor {
  id: string;
  name: string;
  version?: string;
  slop_version: string;
  transport: TransportDescriptor;
  pid?: number;
  capabilities: Capability[];
  description?: string;
}
