import { useSlop } from "@slop-ai/react";
import { slop } from "./slop";
import type { Folder, Note } from "./App";

interface Props {
  folders: Folder[];
  notes: Note[];
  activeFolder: string | null;
  setActiveFolder: (id: string | null) => void;
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>;
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
}

export default function FolderSidebar({
  folders, notes, activeFolder, setActiveFolder, setFolders, setNotes,
}: Props) {
  // --- SLOP: expose folders to AI ---
  useSlop(slop, "folders", {
    type: "collection",
    props: { count: folders.length },
    actions: {
      create_folder: {
        label: "Create Folder",
        params: { name: "string", color: "string" },
        handler: ({ name, color }) => {
          setFolders(prev => [...prev, {
            id: `folder-${Date.now()}`,
            name: name as string,
            color: (color as string) || "#6b7280",
          }]);
        },
      },
    },
    items: folders.map(f => ({
      id: f.id,
      props: {
        name: f.name,
        color: f.color,
        note_count: notes.filter(n => n.folder === f.id).length,
      },
      actions: {
        select: () => setActiveFolder(activeFolder === f.id ? null : f.id),
        delete: {
          dangerous: true,
          handler: () => {
            setFolders(prev => prev.filter(x => x.id !== f.id));
            setNotes(prev => prev.filter(n => n.folder !== f.id));
            if (activeFolder === f.id) setActiveFolder(null);
          },
        },
      },
    })),
  });

  // --- UI (completely SLOP-free) ---
  return (
    <aside className="sidebar">
      <h1>Notes</h1>
      <nav>
        <button
          className={`folder-btn ${activeFolder === null ? "active" : ""}`}
          onClick={() => setActiveFolder(null)}
        >
          All Notes <span className="count">{notes.length}</span>
        </button>
        {folders.map(f => (
          <button
            key={f.id}
            className={`folder-btn ${activeFolder === f.id ? "active" : ""}`}
            onClick={() => setActiveFolder(f.id)}
          >
            <span className="dot" style={{ background: f.color }} />
            {f.name}
            <span className="count">{notes.filter(n => n.folder === f.id).length}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
