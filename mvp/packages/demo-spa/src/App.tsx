import { useState, useCallback } from "react";
import { useSlop } from "./use-slop";
import type { SlopNode } from "./slop-provider";

// --- Types ---

interface Note {
  id: string;
  title: string;
  content: string;
  folder: string;
  pinned: boolean;
  created: string;
}

interface Folder {
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

let nextId = 5;

// --- SLOP tree builder ---

function buildTree(notes: Note[], folders: Folder[], activeFolder: string | null): SlopNode {
  return {
    id: "root",
    type: "root",
    properties: { label: "Notes App" },
    affordances: [
      {
        action: "create_note",
        label: "Create Note",
        description: "Create a new note",
        params: {
          type: "object",
          properties: {
            title: { type: "string", description: "Note title" },
            content: { type: "string", description: "Note content" },
            folder: { type: "string", enum: folders.map(f => f.id), description: "Folder ID" },
          },
          required: ["title"],
        },
      },
      {
        action: "create_folder",
        label: "Create Folder",
        params: {
          type: "object",
          properties: {
            name: { type: "string", description: "Folder name" },
            color: { type: "string", description: "Hex color" },
          },
          required: ["name"],
        },
      },
    ],
    children: [
      {
        id: "folders",
        type: "collection",
        properties: { label: "Folders", count: folders.length },
        children: folders.map(f => ({
          id: f.id,
          type: "group",
          properties: { label: f.name, color: f.color, note_count: notes.filter(n => n.folder === f.id).length },
          affordances: [
            { action: "select_folder", label: `View ${f.name}` },
            { action: "delete_folder", label: "Delete Folder", dangerous: true },
          ],
        })),
      },
      {
        id: "notes",
        type: "collection",
        properties: {
          label: activeFolder ? `Notes in ${folders.find(f => f.id === activeFolder)?.name ?? "All"}` : "All Notes",
          count: (activeFolder ? notes.filter(n => n.folder === activeFolder) : notes).length,
          active_folder: activeFolder,
        },
        children: (activeFolder ? notes.filter(n => n.folder === activeFolder) : notes).map(n => ({
          id: n.id,
          type: "item",
          properties: {
            title: n.title,
            content: n.content,
            folder: n.folder,
            pinned: n.pinned,
            created: n.created,
          },
          affordances: [
            {
              action: "edit_note",
              label: "Edit",
              params: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  content: { type: "string" },
                  folder: { type: "string", enum: folders.map(f => f.id) },
                },
              },
            },
            { action: n.pinned ? "unpin" : "pin", label: n.pinned ? "Unpin" : "Pin" },
            {
              action: "move_note",
              label: "Move to folder",
              params: {
                type: "object",
                properties: {
                  folder: { type: "string", enum: folders.filter(f => f.id !== n.folder).map(f => f.id) },
                },
                required: ["folder"],
              },
            },
            { action: "delete_note", label: "Delete", dangerous: true },
          ],
          meta: { salience: n.pinned ? 0.9 : 0.5 },
        })),
      },
      {
        id: "stats",
        type: "status",
        properties: {
          total_notes: notes.length,
          pinned: notes.filter(n => n.pinned).length,
          folders: folders.length,
        },
        meta: {
          summary: `${notes.length} notes, ${notes.filter(n => n.pinned).length} pinned, ${folders.length} folders`,
        },
      },
    ],
  };
}

// --- App ---

export default function App() {
  const [notes, setNotes] = useState<Note[]>(INITIAL_NOTES);
  const [folders, setFolders] = useState<Folder[]>(INITIAL_FOLDERS);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [showNewNote, setShowNewNote] = useState(false);

  // --- SLOP integration ---
  useSlop({
    id: "notes-app",
    name: "Notes App",
    tree: () => buildTree(notes, folders, activeFolder),
    handlers: {
      create_note: (params) => {
        const note: Note = {
          id: `note-${nextId++}`,
          title: params.title as string,
          content: (params.content as string) ?? "",
          folder: (params.folder as string) ?? folders[0]?.id ?? "personal",
          pinned: false,
          created: new Date().toISOString(),
        };
        setNotes(prev => [...prev, note]);
        return { id: note.id };
      },
      create_folder: (params) => {
        const folder: Folder = {
          id: `folder-${Date.now()}`,
          name: params.name as string,
          color: (params.color as string) ?? "#6b7280",
        };
        setFolders(prev => [...prev, folder]);
        return { id: folder.id };
      },
      edit_note: (params, path) => {
        const id = path.split("/").pop()!;
        setNotes(prev => prev.map(n => n.id === id ? {
          ...n,
          ...(params.title !== undefined && { title: params.title as string }),
          ...(params.content !== undefined && { content: params.content as string }),
          ...(params.folder !== undefined && { folder: params.folder as string }),
        } : n));
      },
      pin: (_, path) => {
        const id = path.split("/").pop()!;
        setNotes(prev => prev.map(n => n.id === id ? { ...n, pinned: true } : n));
      },
      unpin: (_, path) => {
        const id = path.split("/").pop()!;
        setNotes(prev => prev.map(n => n.id === id ? { ...n, pinned: false } : n));
      },
      move_note: (params, path) => {
        const id = path.split("/").pop()!;
        setNotes(prev => prev.map(n => n.id === id ? { ...n, folder: params.folder as string } : n));
      },
      delete_note: (_, path) => {
        const id = path.split("/").pop()!;
        setNotes(prev => prev.filter(n => n.id !== id));
      },
      select_folder: (_, path) => {
        const id = path.split("/").pop()!;
        setActiveFolder(prev => prev === id ? null : id);
      },
      delete_folder: (_, path) => {
        const id = path.split("/").pop()!;
        setFolders(prev => prev.filter(f => f.id !== id));
        setNotes(prev => prev.filter(n => n.folder !== id));
        if (activeFolder === id) setActiveFolder(null);
      },
    },
  });

  // --- Derived ---
  const visibleNotes = activeFolder ? notes.filter(n => n.folder === activeFolder) : notes;
  const sortedNotes = [...visibleNotes].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  // --- Handlers ---
  const addNote = useCallback((title: string, content: string) => {
    const note: Note = {
      id: `note-${nextId++}`,
      title,
      content,
      folder: activeFolder ?? folders[0]?.id ?? "personal",
      pinned: false,
      created: new Date().toISOString(),
    };
    setNotes(prev => [...prev, note]);
    setShowNewNote(false);
  }, [activeFolder, folders]);

  return (
    <div className="app">
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

      <main className="content">
        <header>
          <h2>{activeFolder ? folders.find(f => f.id === activeFolder)?.name ?? "Notes" : "All Notes"}</h2>
          <button className="btn-primary" onClick={() => setShowNewNote(true)}>+ New Note</button>
        </header>

        {showNewNote && (
          <NewNoteForm onSubmit={addNote} onCancel={() => setShowNewNote(false)} />
        )}

        <div className="notes-grid">
          {sortedNotes.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              folder={folders.find(f => f.id === note.folder)}
              isEditing={editingNote === note.id}
              onEdit={() => setEditingNote(note.id)}
              onSave={(title, content) => {
                setNotes(prev => prev.map(n => n.id === note.id ? { ...n, title, content } : n));
                setEditingNote(null);
              }}
              onCancel={() => setEditingNote(null)}
              onPin={() => setNotes(prev => prev.map(n => n.id === note.id ? { ...n, pinned: !n.pinned } : n))}
              onDelete={() => setNotes(prev => prev.filter(n => n.id !== note.id))}
            />
          ))}
          {sortedNotes.length === 0 && (
            <p className="empty">No notes yet. Create one!</p>
          )}
        </div>
      </main>
    </div>
  );
}

// --- Components ---

function NoteCard({ note, folder, isEditing, onEdit, onSave, onCancel, onPin, onDelete }: {
  note: Note;
  folder?: Folder;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (title: string, content: string) => void;
  onCancel: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);

  if (isEditing) {
    return (
      <div className="note-card editing">
        <input value={title} onChange={e => setTitle(e.target.value)} className="edit-title" />
        <textarea value={content} onChange={e => setContent(e.target.value)} className="edit-content" />
        <div className="card-actions">
          <button className="btn-small btn-primary" onClick={() => onSave(title, content)}>Save</button>
          <button className="btn-small" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="note-card" onDoubleClick={onEdit}>
      <div className="card-header">
        {folder && <span className="folder-tag" style={{ background: folder.color + "33", color: folder.color }}>{folder.name}</span>}
        {note.pinned && <span className="pin-icon" title="Pinned">&#9733;</span>}
      </div>
      <h3>{note.title}</h3>
      <p>{note.content}</p>
      <div className="card-actions">
        <button className="btn-icon" onClick={onPin} title={note.pinned ? "Unpin" : "Pin"}>
          {note.pinned ? "&#9733;" : "&#9734;"}
        </button>
        <button className="btn-icon" onClick={onEdit} title="Edit">&#9998;</button>
        <button className="btn-icon danger" onClick={onDelete} title="Delete">&times;</button>
      </div>
    </div>
  );
}

function NewNoteForm({ onSubmit, onCancel }: { onSubmit: (title: string, content: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  return (
    <div className="new-note-form">
      <input placeholder="Note title..." value={title} onChange={e => setTitle(e.target.value)} autoFocus />
      <textarea placeholder="Write something..." value={content} onChange={e => setContent(e.target.value)} />
      <div className="form-actions">
        <button className="btn-primary" onClick={() => { if (title.trim()) onSubmit(title, content); }}>Add Note</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
