import { useState } from "react";
import type { Card } from "../types";
import { computeSalience } from "../salience";

const PRIORITY_LABELS: Record<string, string> = {
  critical: "CRIT",
  high: "HIGH",
  medium: "MED",
  low: "LOW",
};

interface Props {
  card: Card;
  allColumns: string[];
  onMove: (cardId: string, column: string) => void;
  onDelete: (cardId: string) => void;
  onOpenDetail: (cardId: string) => void;
}

export default function CardItem({ card, allColumns, onMove, onDelete, onOpenDetail }: Props) {
  const [showMenu, setShowMenu] = useState(false);
  const sal = computeSalience(card);
  const otherColumns = allColumns.filter((c) => c !== card.column);
  const isOverdue = card.due && new Date(card.due) < new Date() && card.column !== "done";

  const formatDue = (due: string) => {
    const date = new Date(due);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div
      className={`card ${sal.pinned ? "card-pinned" : ""} ${isOverdue ? "card-overdue" : ""}`}
      onClick={() => onOpenDetail(card.id)}
    >
      <div className="card-header">
        <span className={`card-priority priority-${card.priority}`}>
          {PRIORITY_LABELS[card.priority]}
        </span>
        <button
          className="card-menu-btn"
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
        >
          &#8942;
        </button>
      </div>

      <h3 className="card-title">{card.title}</h3>

      <div className="card-footer">
        {card.due && (
          <span className={`card-due ${isOverdue ? "overdue" : ""}`}>
            {formatDue(card.due)}
          </span>
        )}
        {card.tags.length > 0 && (
          <div className="card-tags">
            {card.tags.map((tag) => (
              <span key={tag} className="card-tag">{tag}</span>
            ))}
          </div>
        )}
        {card.description && <span className="card-has-desc">&#9776;</span>}
      </div>

      {showMenu && (
        <div className="card-menu" onClick={(e) => e.stopPropagation()}>
          {otherColumns.map((col) => (
            <button
              key={col}
              className="card-menu-item"
              onClick={() => {
                onMove(card.id, col);
                setShowMenu(false);
              }}
            >
              Move to {col}
            </button>
          ))}
          <button
            className="card-menu-item danger"
            onClick={() => {
              onDelete(card.id);
              setShowMenu(false);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
