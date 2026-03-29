import { createSignal, For, Show } from "solid-js";
import { useSlop } from "@slop-ai/solid";
import { slop } from "./slop";

interface Note {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
}

let nextId = 4;

const INITIAL_NOTES: Note[] = [
  { id: "1", title: "Grocery list", content: "Milk, eggs, bread, coffee", pinned: true },
  { id: "2", title: "Meeting notes", content: "Discuss Q3 roadmap with team", pinned: false },
  { id: "3", title: "App idea", content: "A protocol for AI to observe app state", pinned: true },
];

export default function App() {
  const [notes, setNotes] = createSignal<Note[]>(INITIAL_NOTES);
  const [title, setTitle] = createSignal("");
  const [content, setContent] = createSignal("");
  const [showForm, setShowForm] = createSignal(false);

  // --- SLOP integration ---
  useSlop(slop, "notes", () => ({
    type: "collection",
    props: { count: notes().length, pinned: notes().filter(n => n.pinned).length },
    items: notes().map(n => ({
      id: n.id,
      props: { title: n.title, pinned: n.pinned },
      actions: {
        toggle_pin: () => setNotes(prev => prev.map(x => x.id === n.id ? { ...x, pinned: !x.pinned } : x)),
        delete: () => setNotes(prev => prev.filter(x => x.id !== n.id)),
      },
    })),
    actions: {
      create: (params: { title: string; content?: string }) => {
        const id = String(nextId++);
        setNotes(prev => [...prev, { id, title: params.title, content: params.content ?? "", pinned: false }]);
        return { id };
      },
    },
  }));

  function addNote() {
    if (!title().trim()) return;
    const id = String(nextId++);
    setNotes(prev => [...prev, { id, title: title(), content: content(), pinned: false }]);
    setTitle("");
    setContent("");
    setShowForm(false);
  }

  return (
    <div style={{ "max-width": "680px", margin: "0 auto", padding: "32px 20px" }}>
      <header style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "24px" }}>
        <h1 style={{ "font-size": "22px" }}>Notes</h1>
        <button
          style={{ background: "#238636", color: "#fff", border: "none", padding: "8px 16px", "border-radius": "6px", cursor: "pointer", "font-size": "13px" }}
          onClick={() => setShowForm(!showForm())}
        >
          {showForm() ? "Cancel" : "+ New Note"}
        </button>
      </header>

      <Show when={showForm()}>
        <div style={{ background: "#1c2028", border: "1px solid #58a6ff", "border-radius": "8px", padding: "16px", "margin-bottom": "16px", display: "flex", "flex-direction": "column", gap: "8px" }}>
          <input
            placeholder="Title"
            value={title()}
            onInput={e => setTitle(e.currentTarget.value)}
            style={{ width: "100%", background: "#0d1117", border: "1px solid #30363d", color: "#e1e4e8", padding: "10px", "border-radius": "6px", "font-size": "14px" }}
          />
          <textarea
            placeholder="Content"
            value={content()}
            onInput={e => setContent(e.currentTarget.value)}
            style={{ width: "100%", background: "#0d1117", border: "1px solid #30363d", color: "#e1e4e8", padding: "10px", "border-radius": "6px", "font-size": "14px", height: "80px", resize: "vertical" }}
          />
          <button
            onClick={addNote}
            style={{ "align-self": "flex-end", background: "#238636", color: "#fff", border: "none", padding: "8px 16px", "border-radius": "6px", cursor: "pointer", "font-size": "13px" }}
          >
            Add Note
          </button>
        </div>
      </Show>

      <div style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
        <For each={notes()}>
          {note => (
            <div style={{ background: "#1c2028", border: "1px solid #30363d", "border-radius": "8px", padding: "16px" }}>
              <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "6px" }}>
                <Show when={note.pinned}>
                  <span style={{ color: "#f59e0b", "font-size": "14px" }}>&#9733;</span>
                </Show>
                <h3 style={{ "font-size": "15px", "font-weight": "600" }}>{note.title}</h3>
              </div>
              <p style={{ "font-size": "13px", color: "#8b949e", "line-height": "1.5", "margin-bottom": "12px" }}>{note.content}</p>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  onClick={() => setNotes(prev => prev.map(n => n.id === note.id ? { ...n, pinned: !n.pinned } : n))}
                  style={{ background: "#30363d", border: "none", color: "#8b949e", padding: "4px 10px", "border-radius": "4px", cursor: "pointer", "font-size": "12px" }}
                >
                  {note.pinned ? "Unpin" : "Pin"}
                </button>
                <button
                  onClick={() => setNotes(prev => prev.filter(n => n.id !== note.id))}
                  style={{ background: "#30363d", border: "none", color: "#da3633", padding: "4px 10px", "border-radius": "4px", cursor: "pointer", "font-size": "12px" }}
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </For>
      </div>

      <Show when={notes().length === 0}>
        <p style={{ color: "#484f58", "text-align": "center", padding: "40px", "font-size": "14px" }}>No notes yet. Create one to get started.</p>
      </Show>
    </div>
  );
}
