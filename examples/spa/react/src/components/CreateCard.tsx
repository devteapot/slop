import { useState } from "react";
import type { Card } from "../types";

interface Props {
  columns: string[];
  onSubmit: (
    title: string,
    column?: string,
    priority?: Card["priority"],
    due?: string,
    description?: string,
    tags?: string[],
  ) => void;
  onClose: () => void;
}

export default function CreateCard({ columns, onSubmit, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [column, setColumn] = useState(columns[0] || "");
  const [priority, setPriority] = useState<Card["priority"]>("medium");
  const [due, setDue] = useState("");
  const [tags, setTags] = useState("");

  const handleSubmit = () => {
    if (!title.trim()) return;
    onSubmit(
      title.trim(),
      column,
      priority,
      due || undefined,
      undefined,
      tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">New Card</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body">
          <div className="form-field">
            <label className="form-label">TITLE</label>
            <input
              className="form-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="Card title..."
              autoFocus
            />
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label">COLUMN</label>
              <select className="form-select" value={column} onChange={(e) => setColumn(e.target.value)}>
                {columns.map((col) => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label className="form-label">PRIORITY</label>
              <select className="form-select" value={priority} onChange={(e) => setPriority(e.target.value as Card["priority"])}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label">DUE DATE</label>
              <input className="form-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>

            <div className="form-field">
              <label className="form-label">TAGS</label>
              <input
                className="form-input"
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="tag1, tag2, ..."
              />
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={!title.trim()}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
