import { useState } from "react";
import { useSlop } from "@slop/react";
import { slop } from "./slop";
import type { Note, Folder } from "./App";

let nextId = 5;

interface Props {
  notes: Note[];
  folders: Folder[];
  activeFolder: string | null;
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
}

export default function NotesList({ notes, folders, activeFolder, setNotes }: Props) {
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [showNewNote, setShowNewNote] = useState(false);

  const visibleNotes = activeFolder ? notes.filter(n => n.folder === activeFolder) : notes;
  const sortedNotes = [...visibleNotes].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  // --- SLOP: expose notes to AI ---
  useSlop(slop, "notes", {
    type: "collection",
    props: {
      count: visibleNotes.length,
      active_folder: activeFolder,
      label: activeFolder
        ? `Notes in ${folders.find(f => f.id === activeFolder)?.name ?? "All"}`
        : "All Notes",
    },
    actions: {
      create: {
        label: "Create Note",
        description: "Create a new note",
        params: {
          title: "string",
          content: "string",
          folder: { type: "string", enum: folders.map(f => f.id), description: "Folder ID" },
        },
        handler: ({ title, content, folder }) => {
          const note: Note = {
            id: `note-${nextId++}`,
            title: title as string,
            content: (content as string) ?? "",
            folder: (folder as string) ?? activeFolder ?? folders[0]?.id ?? "personal",
            pinned: false,
            created: new Date().toISOString(),
          };
          setNotes(prev => [...prev, note]);
          return { id: note.id };
        },
      },
    },
    items: visibleNotes.map(note => ({
      id: note.id,
      props: {
        title: note.title,
        content: note.content,
        folder: note.folder,
        pinned: note.pinned,
        created: note.created,
      },
      meta: { salience: note.pinned ? 0.9 : 0.5 },
      actions: {
        edit: {
          label: "Edit",
          params: { title: "string", content: "string" },
          handler: ({ title, content }) => {
            setNotes(prev => prev.map(n => n.id === note.id ? {
              ...n,
              ...(title !== undefined && { title: title as string }),
              ...(content !== undefined && { content: content as string }),
            } : n));
          },
        },
        toggle_pin: () => {
          setNotes(prev => prev.map(n => n.id === note.id ? { ...n, pinned: !n.pinned } : n));
        },
        move: {
          label: "Move to folder",
          params: {
            folder: { type: "string", enum: folders.filter(f => f.id !== note.folder).map(f => f.id) },
          },
          handler: ({ folder }) => {
            setNotes(prev => prev.map(n => n.id === note.id ? { ...n, folder: folder as string } : n));
          },
        },
        delete: {
          dangerous: true,
          handler: () => {
            setNotes(prev => prev.filter(n => n.id !== note.id));
          },
        },
      },
    })),
  });

  // --- UI (completely SLOP-free) ---
  const addNote = (title: string, content: string) => {
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
  };

  return (
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
  );
}

// --- Pure UI components (no SLOP) ---

function NoteCard({ note, folder, isEditing, onEdit, onSave, onCancel, onPin, onDelete }: {
  note: Note; folder?: Folder; isEditing: boolean;
  onEdit: () => void; onSave: (t: string, c: string) => void; onCancel: () => void;
  onPin: () => void; onDelete: () => void;
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
          {note.pinned ? "★" : "☆"}
        </button>
        <button className="btn-icon" onClick={onEdit} title="Edit">✎</button>
        <button className="btn-icon danger" onClick={onDelete} title="Delete">×</button>
      </div>
    </div>
  );
}

function NewNoteForm({ onSubmit, onCancel }: { onSubmit: (t: string, c: string) => void; onCancel: () => void }) {
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
