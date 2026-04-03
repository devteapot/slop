import { useState } from "react";
import type { Board } from "../types";

interface Props {
  boards: Board[];
  activeBoardId: string;
  onNavigate: (boardId: string) => void;
  onCreateBoard: (name: string) => void;
}

export default function BoardSwitcher({ boards, activeBoardId, onNavigate, onCreateBoard }: Props) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const handleSubmit = () => {
    if (newName.trim()) {
      onCreateBoard(newName.trim());
      setNewName("");
      setCreating(false);
    }
  };

  return (
    <nav className="board-switcher">
      {boards.map((board) => (
        <button
          key={board.id}
          className={`board-tab ${board.id === activeBoardId ? "active" : ""}`}
          onClick={() => onNavigate(board.id)}
        >
          {board.name}
        </button>
      ))}
      {creating ? (
        <span className="board-tab-create">
          <input
            className="board-tab-input"
            type="text"
            placeholder="Board name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            autoFocus
          />
          <button className="btn-ghost" onClick={handleSubmit}>&#10003;</button>
          <button className="btn-ghost" onClick={() => setCreating(false)}>&times;</button>
        </span>
      ) : (
        <button className="board-tab add" onClick={() => setCreating(true)}>+</button>
      )}
    </nav>
  );
}
