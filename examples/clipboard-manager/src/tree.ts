import type { SlopNode } from "@slop/types";
import type { AppState } from "./state";

export function buildTree(state: AppState): SlopNode {
  const favorites = state.entries.filter(e => e.favorite);
  const recent = state.entries.filter(e => !e.favorite);

  return {
    id: "root",
    type: "root",
    properties: { label: "Clipboard Manager" },
    affordances: [
      {
        action: "add_entry",
        label: "Add Entry",
        description: "Manually add text to clipboard history",
        params: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text content to add" },
          },
          required: ["text"],
        },
      },
      ...(state.entries.length > 0 ? [{
        action: "clear_history",
        label: "Clear History",
        description: "Delete all clipboard entries",
        dangerous: true as const,
      }] : []),
    ],
    children: [
      // Favorites
      ...(favorites.length > 0 ? [{
        id: "favorites",
        type: "collection" as const,
        properties: {
          label: "Favorites",
          count: favorites.length,
        },
        children: favorites.map(e => entryToNode(e)),
      }] : []),
      // Recent
      {
        id: "recent",
        type: "collection",
        properties: {
          label: "Recent",
          count: recent.length,
        },
        children: recent.map(e => entryToNode(e)),
      },
      // Stats
      {
        id: "stats",
        type: "status",
        properties: {
          total: state.entries.length,
          favorites: favorites.length,
          max_entries: state.maxEntries,
        },
        meta: {
          summary: `${state.entries.length} entries, ${favorites.length} favorited`,
        },
      },
    ],
  };
}

function entryToNode(entry: AppState["entries"][0]): SlopNode {
  return {
    id: entry.id,
    type: "item",
    properties: {
      preview: entry.preview,
      text: entry.text.length > 200 ? entry.text.slice(0, 200) + "..." : entry.text,
      favorite: entry.favorite,
      created: entry.created,
      length: entry.text.length,
    },
    affordances: [
      {
        action: "copy_to_clipboard",
        label: "Copy to Clipboard",
        description: "Copy this entry back to the system clipboard",
      },
      entry.favorite
        ? { action: "unfavorite", label: "Remove Favorite" }
        : { action: "favorite", label: "Add Favorite" },
      {
        action: "delete",
        label: "Delete Entry",
        dangerous: true,
      },
    ],
    meta: {
      salience: entry.favorite ? 0.8 : 0.5,
    },
  };
}
