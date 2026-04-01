import { invoke } from "@tauri-apps/api/core";
import type {
  WorkspaceSummary,
  WorkspaceDetail,
  ProviderSummary,
  ProviderConnectResult,
  LlmProfile,
} from "./types";

// Workspace commands
export const listWorkspaces = () => invoke<WorkspaceSummary[]>("list_workspaces");
export const getWorkspace = (workspaceId: string) =>
  invoke<WorkspaceDetail>("get_workspace", { workspaceId });
export const createWorkspace = (name: string) =>
  invoke<WorkspaceSummary>("create_workspace", { name });
export const renameWorkspace = (workspaceId: string, name: string) =>
  invoke<void>("rename_workspace", { workspaceId, name });
export const deleteWorkspace = (workspaceId: string) =>
  invoke<void>("delete_workspace", { workspaceId });
export const setActiveWorkspace = (workspaceId: string) =>
  invoke<void>("set_active_workspace", { workspaceId });

// Provider commands
export const listProviders = () => invoke<ProviderSummary[]>("list_providers");
export const addManualProvider = (url: string, name?: string) =>
  invoke<ProviderSummary>("add_manual_provider", { url, name });
export const removeProvider = (providerId: string) =>
  invoke<void>("remove_provider", { providerId });
export const connectProvider = (providerId: string, workspaceId: string) =>
  invoke<void>("connect_provider", { providerId, workspaceId });
export const disconnectProvider = (providerId: string, workspaceId: string) =>
  invoke<void>("disconnect_provider", { providerId, workspaceId });
export const refreshDiscovery = () => invoke<ProviderSummary[]>("refresh_discovery");

// Chat commands
export const sendMessage = (workspaceId: string, text: string) =>
  invoke<void>("send_message", { workspaceId, text });
export const clearChat = (workspaceId: string) =>
  invoke<void>("clear_chat", { workspaceId });

// LLM profile commands
export const listProfiles = () => invoke<LlmProfile[]>("list_profiles");
export const getActiveProfile = () => invoke<LlmProfile>("get_active_profile");
export const addProfile = (profile: LlmProfile) =>
  invoke<void>("add_profile", { profile });
export const updateProfile = (id: string, updates: Partial<LlmProfile>) =>
  invoke<void>("update_profile", { id, updates });
export const deleteProfile = (id: string) =>
  invoke<void>("delete_profile", { id });
export const setActiveProfile = (id: string) =>
  invoke<void>("set_active_profile", { id });
export const setModel = (model: string) =>
  invoke<void>("set_model", { model });
export const fetchModels = () => invoke<string[]>("fetch_models");

// Bridge commands
export const bridgeSend = (message: unknown) =>
  invoke<void>("bridge_send", { message });
