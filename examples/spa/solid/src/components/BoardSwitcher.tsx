import { createSignal, Show, For } from "solid-js";
import type { Board } from "../types";

interface Props {
  boards: Board[];
  activeBoardId: string;
  onNavigate: (boardId: string) => void;
  onCreateBoard: (name: string) => void;
}

export default function BoardSwitcher(props: Props) {
  const [creating, setCreating] = createSignal(false);
  const [newName, setNewName] = createSignal("");

  const handleSubmit = () => {
    if (newName().trim()) {
      props.onCreateBoard(newName().trim());
      setNewName("");
      setCreating(false);
    }
  };

  return (
    <nav class="board-switcher">
      <For each={props.boards}>
        {(board) => (
          <button
            class={`board-tab ${board.id === props.activeBoardId ? "active" : ""}`}
            onClick={() => props.onNavigate(board.id)}
          >
            {board.name}
          </button>
        )}
      </For>
      <Show
        when={creating()}
        fallback={
          <button class="board-tab add" onClick={() => setCreating(true)}>+</button>
        }
      >
        <span class="board-tab-create">
          <input
            class="board-tab-input"
            type="text"
            placeholder="Board name..."
            value={newName()}
            onInput={(e) => setNewName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            autofocus
          />
          <button class="btn-ghost" onClick={handleSubmit}>&#10003;</button>
          <button class="btn-ghost" onClick={() => setCreating(false)}>&times;</button>
        </span>
      </Show>
    </nav>
  );
}
