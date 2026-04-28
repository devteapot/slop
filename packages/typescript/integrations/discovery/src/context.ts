import {
  type AvailableSlopApp,
  renderSlopAvailableApps,
  renderSlopStateTail,
  type SlopNode,
  type SlopStateApp,
} from "@slop-ai/consumer";
import type { ConnectedProvider, DiscoveryService, ProviderDescriptor } from "./discovery";

export interface BuildContextOptions {
  /** ISO timestamp; defaults to `new Date().toISOString()`. Pass an explicit value for byte-stable output. */
  generatedAt?: string;
  /**
   * Optional per-provider tree projection applied before rendering. The spec
   * (`spec/integrations/llm-context.md`) recommends salience and view-scope
   * filtering before the tail is built. Use `prepareTree` / `filterTree` /
   * `autoCompact` from `@slop-ai/core` here, or any custom transform that
   * returns a `SlopNode`. If omitted, the raw subscribed tree is rendered
   * unchanged — appropriate only for small apps that fit comfortably.
   */
  projectTree?: (tree: SlopNode, provider: ConnectedProvider) => SlopNode;
}

/**
 * Render the live-state tail for currently connected providers. Includes
 * "awaiting snapshot" markers for providers that are connected but have not
 * yet produced a tree.
 */
export function buildSlopStateTail(
  discovery: DiscoveryService,
  options: BuildContextOptions = {},
): string | null {
  const apps = discovery.getProviders().map((p) => toStateApp(p, options.projectTree));
  return renderSlopStateTail({ apps, generatedAt: options.generatedAt });
}

/**
 * Render the catalog tail for discovered providers that are NOT currently
 * connected. This is host capability context, not live observation, and goes
 * into a sibling `<slop-apps-available>` block per spec/integrations/llm-context.md.
 */
export function buildSlopAvailableAppsTail(
  discovery: DiscoveryService,
  options: BuildContextOptions = {},
): string | null {
  const connectedIds = new Set(discovery.getProviders().map((p) => p.id));
  const unconnected = discovery.getDiscovered().filter((d) => !connectedIds.has(d.id));
  const apps = unconnected.map(toAvailableApp);
  return renderSlopAvailableApps({ apps, generatedAt: options.generatedAt });
}

export interface SlopContext {
  stateTail: string | null;
  availableAppsTail: string | null;
}

/**
 * Convenience helper returning both context blocks in one call. Either field
 * may be null if the corresponding list is empty; callers can pass them
 * directly into `composeMessagesWithSlopState`.
 */
export function buildSlopContext(
  discovery: DiscoveryService,
  options: BuildContextOptions = {},
): SlopContext {
  return {
    stateTail: buildSlopStateTail(discovery, options),
    availableAppsTail: buildSlopAvailableAppsTail(discovery, options),
  };
}

function toStateApp(
  provider: ConnectedProvider,
  projectTree?: BuildContextOptions["projectTree"],
): SlopStateApp {
  const raw = provider.consumer.getTree(provider.subscriptionId);
  const tree = raw && projectTree ? projectTree(raw, provider) : raw;
  return {
    id: provider.id,
    name: provider.name,
    tree: tree ?? null,
  };
}

function toAvailableApp(desc: ProviderDescriptor): AvailableSlopApp {
  return {
    id: desc.id,
    name: desc.name,
    transport: desc.transport.type,
    source: desc.source ?? "local",
    capabilities: desc.capabilities,
  };
}
