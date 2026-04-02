import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { UiMessage, ChatMessagePayload, ChatProcessingPayload } from "../lib/types";
import * as commands from "../lib/commands";

interface ChatState {
  messages: Record<string, UiMessage[]>;
  processing: Record<string, boolean>;

  init: (activeWorkspaceId?: string) => Promise<void>;
  destroy: () => void;
  sendMessage: (workspaceId: string, text: string) => Promise<void>;
  clearChat: (workspaceId: string) => Promise<void>;
  loadWorkspace: (workspaceId: string) => Promise<void>;
}

let unlisteners: UnlistenFn[] = [];

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  processing: {},

  init: async (activeWorkspaceId?: string) => {
    for (const fn of unlisteners) fn();
    unlisteners = [];

    // Load existing messages for the active workspace
    if (activeWorkspaceId) {
      try {
        const detail = await commands.getWorkspace(activeWorkspaceId);
        set((state) => ({
          messages: { ...state.messages, [activeWorkspaceId]: detail.ui_messages },
        }));
      } catch (error) {
        console.warn("[slop] failed to load active workspace chat history:", error);
      }
    }

    const u1 = await listen<ChatMessagePayload>("chat-message", (e) => {
      const { workspace_id, message } = e.payload;
      set((state) => {
        const existing = state.messages[workspace_id] ?? [];
        return {
          messages: { ...state.messages, [workspace_id]: [...existing, message] },
        };
      });
    });

    const u2 = await listen<ChatProcessingPayload>("chat-processing", (e) => {
      const { workspace_id, processing } = e.payload;
      set((state) => ({
        processing: { ...state.processing, [workspace_id]: processing },
      }));
    });

    unlisteners = [u1, u2];
  },

  destroy: () => {
    for (const fn of unlisteners) fn();
    unlisteners = [];
  },

  sendMessage: async (workspaceId, text) => {
    await commands.sendMessage(workspaceId, text);
  },

  clearChat: async (workspaceId) => {
    await commands.clearChat(workspaceId);
    set((state) => {
      const { [workspaceId]: _, ...rest } = state.messages;
      return { messages: rest };
    });
  },

  loadWorkspace: async (workspaceId) => {
    try {
      const detail = await commands.getWorkspace(workspaceId);
      set((state) => ({
        messages: { ...state.messages, [workspaceId]: detail.ui_messages },
      }));
    } catch (error) {
      console.warn(`[slop] failed to load chat history for workspace "${workspaceId}":`, error);
    }
  },
}));
