import { clipboard } from "electron";

export interface ClipboardEntry {
  id: string;
  text: string;
  preview: string;
  favorite: boolean;
  created: string;
}

export interface AppState {
  entries: ClipboardEntry[];
  maxEntries: number;
}

let nextId = 1;

export function createState(): AppState {
  return {
    entries: [],
    maxEntries: 50,
  };
}

function makePreview(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 80 ? line.slice(0, 77) + "..." : line;
}

export function addEntry(state: AppState, text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Skip duplicates of the most recent entry
  if (state.entries.length > 0 && state.entries[0].text === trimmed) return null;

  const entry: ClipboardEntry = {
    id: `clip-${nextId++}`,
    text: trimmed,
    preview: makePreview(trimmed),
    favorite: false,
    created: new Date().toISOString(),
  };
  state.entries.unshift(entry);

  // Trim to max, but keep favorites
  while (state.entries.length > state.maxEntries) {
    const lastNonFav = [...state.entries].reverse().findIndex(e => !e.favorite);
    if (lastNonFav === -1) break;
    state.entries.splice(state.entries.length - 1 - lastNonFav, 1);
  }

  return `Captured: "${entry.preview}"`;
}

export function toggleFavorite(state: AppState, entryId: string): string {
  const entry = state.entries.find(e => e.id === entryId);
  if (!entry) throw { code: "not_found", message: `Entry ${entryId} not found` };
  entry.favorite = !entry.favorite;
  return `${entry.favorite ? "Favorited" : "Unfavorited"} "${entry.preview}"`;
}

export function deleteEntry(state: AppState, entryId: string): string {
  const idx = state.entries.findIndex(e => e.id === entryId);
  if (idx === -1) throw { code: "not_found", message: `Entry ${entryId} not found` };
  const [entry] = state.entries.splice(idx, 1);
  return `Deleted "${entry.preview}"`;
}

export function clearHistory(state: AppState): string {
  const count = state.entries.length;
  state.entries = [];
  return `Cleared ${count} entries`;
}

export function copyToClipboard(state: AppState, entryId: string): string {
  const entry = state.entries.find(e => e.id === entryId);
  if (!entry) throw { code: "not_found", message: `Entry ${entryId} not found` };
  clipboard.writeText(entry.text);
  return `Copied "${entry.preview}" to clipboard`;
}
