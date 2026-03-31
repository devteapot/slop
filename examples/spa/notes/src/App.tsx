import { useState } from "react";
import { useSlop } from "@slop-ai/react";
import { slop } from "./slop";
import FolderSidebar from "./FolderSidebar";
import NotesList from "./NotesList";

// --- Types ---

export interface Note {
  id: string;
  title: string;
  content: string;
  folder: string;
  pinned: boolean;
  created: string;
}

export interface Folder {
  id: string;
  name: string;
  color: string;
}

// --- Initial data ---

const INITIAL_FOLDERS: Folder[] = [
  { id: "personal", name: "Personal", color: "#4a9eff" },
  { id: "work", name: "Work", color: "#f59e0b" },
  { id: "ideas", name: "Ideas", color: "#a855f7" },
];

const INITIAL_NOTES: Note[] = [
  { id: "note-1", title: "Grocery list", content: "Milk, eggs, bread, coffee", folder: "personal", pinned: true, created: new Date().toISOString() },
  { id: "note-2", title: "Meeting notes", content: "Discuss Q3 roadmap with team", folder: "work", pinned: false, created: new Date().toISOString() },
  { id: "note-3", title: "App idea", content: "A protocol for AI to observe app state...", folder: "ideas", pinned: true, created: new Date().toISOString() },
  { id: "note-4", title: "Book recommendations", content: "Designing Data-Intensive Applications, SICP", folder: "personal", pinned: false, created: new Date().toISOString() },
];

// --- App ---

export default function App() {
  const [notes, setNotes] = useState<Note[]>(INITIAL_NOTES);
  const [folders, setFolders] = useState<Folder[]>(INITIAL_FOLDERS);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);

  // --- SLOP: expose app-level stats to AI ---
  const pinnedCount = notes.filter(n => n.pinned).length;

  useSlop(slop, "stats", {
    type: "status",
    props: {
      total_notes: notes.length,
      pinned: pinnedCount,
      folders: folders.length,
    },
    meta: {
      summary: `${notes.length} notes, ${pinnedCount} pinned, ${folders.length} folders`,
    },
  });

  // --- UI (completely SLOP-free) ---
  return (
    <div className="app">
      <FolderSidebar
        folders={folders}
        notes={notes}
        activeFolder={activeFolder}
        setActiveFolder={setActiveFolder}
        setFolders={setFolders}
        setNotes={setNotes}
      />
      <NotesList
        notes={notes}
        folders={folders}
        activeFolder={activeFolder}
        setNotes={setNotes}
      />
    </div>
  );
}
