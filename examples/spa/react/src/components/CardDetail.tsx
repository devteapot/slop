import { useState } from "react";
import type { Card } from "../types";

interface Props {
  card: Card;
  columns: string[];
  onEdit: (updates: Partial<Pick<Card, "title" | "priority" | "due" | "tags">>) => void;
  onMove: (column: string) => void;
  onDelete: () => void;
  onSetDescription: (content: string) => void;
  onClose: () => void;
}

export default function CardDetail({ card, columns, onEdit, onMove, onDelete, onSetDescription, onClose }: Props) {
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(card.description);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(card.title);

  const otherColumns = columns.filter((c) => c !== card.column);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          {editingTitle ? (
            <input
              className="modal-title-input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                if (titleDraft.trim() && titleDraft !== card.title) {
                  onEdit({ title: titleDraft.trim() });
                }
                setEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") { setTitleDraft(card.title); setEditingTitle(false); }
              }}
              autoFocus
            />
          ) : (
            <h2 className="modal-title" onClick={() => setEditingTitle(true)}>{card.title}</h2>
          )}
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body">
          <div className="detail-row">
            <span className="detail-label">PRIORITY</span>
            <select
              className="detail-select"
              value={card.priority}
              onChange={(e) => onEdit({ priority: e.target.value as Card["priority"] })}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          <div className="detail-row">
            <span className="detail-label">COLUMN</span>
            <select
              className="detail-select"
              value={card.column}
              onChange={(e) => onMove(e.target.value)}
            >
              {columns.map((col) => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>
          </div>

          <div className="detail-row">
            <span className="detail-label">DUE DATE</span>
            <input
              className="detail-input"
              type="date"
              value={card.due || ""}
              onChange={(e) => onEdit({ due: e.target.value || null as unknown as string })}
            />
          </div>

          <div className="detail-row">
            <span className="detail-label">TAGS</span>
            <input
              className="detail-input"
              type="text"
              value={card.tags.join(", ")}
              placeholder="tag1, tag2, ..."
              onChange={(e) =>
                onEdit({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })
              }
            />
          </div>

          <div className="detail-description">
            <span className="detail-label">DESCRIPTION</span>
            {editingDesc ? (
              <div className="desc-editor">
                <textarea
                  className="desc-textarea"
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  rows={8}
                  autoFocus
                />
                <div className="desc-actions">
                  <button
                    className="btn-primary btn-sm"
                    onClick={() => {
                      onSetDescription(descDraft);
                      setEditingDesc(false);
                    }}
                  >
                    Save
                  </button>
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => {
                      setDescDraft(card.description);
                      setEditingDesc(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="desc-preview"
                onClick={() => { setDescDraft(card.description); setEditingDesc(true); }}
              >
                {card.description ? (
                  <pre className="desc-content">{card.description}</pre>
                ) : (
                  <p className="desc-placeholder">Click to add a description...</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-danger" onClick={onDelete}>Delete Card</button>
        </div>
      </div>
    </div>
  );
}
