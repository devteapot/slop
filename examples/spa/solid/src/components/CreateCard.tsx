import { createSignal, For } from "solid-js";
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

export default function CreateCard(props: Props) {
  const [title, setTitle] = createSignal("");
  const [column, setColumn] = createSignal(props.columns[0] || "");
  const [priority, setPriority] = createSignal<Card["priority"]>("medium");
  const [due, setDue] = createSignal("");
  const [tags, setTags] = createSignal("");

  const handleSubmit = () => {
    if (!title().trim()) return;
    props.onSubmit(
      title().trim(),
      column(),
      priority(),
      due() || undefined,
      undefined,
      tags() ? tags().split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    );
  };

  return (
    <div class="modal-overlay" onClick={props.onClose}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2 class="modal-title">New Card</h2>
          <button class="modal-close" onClick={props.onClose}>&times;</button>
        </div>

        <div class="modal-body">
          <div class="form-field">
            <label class="form-label">TITLE</label>
            <input
              class="form-input"
              type="text"
              value={title()}
              onInput={(e) => setTitle(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="Card title..."
              autofocus
            />
          </div>

          <div class="form-row">
            <div class="form-field">
              <label class="form-label">COLUMN</label>
              <select class="form-select" value={column()} onChange={(e) => setColumn(e.currentTarget.value)}>
                <For each={props.columns}>
                  {(col) => <option value={col}>{col}</option>}
                </For>
              </select>
            </div>

            <div class="form-field">
              <label class="form-label">PRIORITY</label>
              <select class="form-select" value={priority()} onChange={(e) => setPriority(e.currentTarget.value as Card["priority"])}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-field">
              <label class="form-label">DUE DATE</label>
              <input class="form-input" type="date" value={due()} onChange={(e) => setDue(e.currentTarget.value)} />
            </div>

            <div class="form-field">
              <label class="form-label">TAGS</label>
              <input
                class="form-input"
                type="text"
                value={tags()}
                onInput={(e) => setTags(e.currentTarget.value)}
                placeholder="tag1, tag2, ..."
              />
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-ghost" onClick={props.onClose}>Cancel</button>
          <button class="btn-primary" onClick={handleSubmit} disabled={!title().trim()}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
