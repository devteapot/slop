import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ProviderSummary,
  ProviderDiscoveredPayload,
  ProviderRemovedPayload,
  ProviderStatusPayload,
  ChatMessagePayload,
  ChatProcessingPayload,
  WorkspaceSummary,
  WorkspacesChangedPayload,
  ProfilesChangedPayload,
} from "./types";

type Handler<T> = (payload: T) => void;

interface EventHandlers {
  onProviderDiscovered?: Handler<ProviderSummary>;
  onProviderRemoved?: Handler<{ provider_id: string }>;
  onProviderStatus?: Handler<ProviderStatusPayload>;
  onChatMessage?: Handler<ChatMessagePayload>;
  onChatProcessing?: Handler<ChatProcessingPayload>;
  onWorkspacesChanged?: Handler<{ workspaces: WorkspaceSummary[] }>;
  onProfilesChanged?: Handler<ProfilesChangedPayload>;
}

let unlisteners: UnlistenFn[] = [];

export async function setupEvents(handlers: EventHandlers) {
  // Clean up any existing listeners
  cleanup();

  const promises: Promise<UnlistenFn>[] = [];

  if (handlers.onProviderDiscovered) {
    const h = handlers.onProviderDiscovered;
    promises.push(listen<ProviderDiscoveredPayload>("provider-discovered", (e) => h(e.payload.provider)));
  }
  if (handlers.onProviderRemoved) {
    const h = handlers.onProviderRemoved;
    promises.push(listen<ProviderRemovedPayload>("provider-removed", (e) => h(e.payload)));
  }
  if (handlers.onProviderStatus) {
    const h = handlers.onProviderStatus;
    promises.push(listen("provider-status", (e) => h(e.payload as ProviderStatusPayload)));
  }
  if (handlers.onChatMessage) {
    const h = handlers.onChatMessage;
    promises.push(listen("chat-message", (e) => h(e.payload as ChatMessagePayload)));
  }
  if (handlers.onChatProcessing) {
    const h = handlers.onChatProcessing;
    promises.push(listen("chat-processing", (e) => h(e.payload as ChatProcessingPayload)));
  }
  if (handlers.onWorkspacesChanged) {
    const h = handlers.onWorkspacesChanged;
    promises.push(listen<WorkspacesChangedPayload>("workspaces-changed", (e) => h(e.payload)));
  }
  if (handlers.onProfilesChanged) {
    const h = handlers.onProfilesChanged;
    promises.push(listen("profiles-changed", (e) => h(e.payload as ProfilesChangedPayload)));
  }

  unlisteners = await Promise.all(promises);
}

export function cleanup() {
  for (const fn of unlisteners) {
    fn();
  }
  unlisteners = [];
}
