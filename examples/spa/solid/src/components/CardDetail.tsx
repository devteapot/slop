import { createSignal, Show, For } from "solid-js";
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

export default function CardDetail(props: Props) {
  const [editingDesc, setEditingDesc] = createSignal(false);
  const [descDraft, setDescDraft] = createSignal(props.card.description);
  const [editingTitle, setEditingTitle] = createSignal(false);
  const [titleDraft, setTitleDraft] = createSignal(props.card.title);

  return (
    <div class="modal-overlay" onClick={props.onClose}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <Show
            when={editingTitle()}
            fallback={
              <h2 class="modal-title" onClick={() => setEditingTitle(true)}>{props.card.title}</h2>
            }
          >
            <input
              class="modal-title-input"
              value={titleDraft()}
              onInput={(e) => setTitleDraft(e.currentTarget.value)}
              onBlur={() => {
                if (titleDraft().trim() && titleDraft() !== props.card.title) {
                  props.onEdit({ title: titleDraft().trim() });
                }
                setEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") { setTitleDraft(props.card.title); setEditingTitle(false); }
              }}
              autofocus
            />
          </Show>
          <button class="modal-close" onClick={props.onClose}>&times;</button>
        </div>

        <div class="modal-body">
          <div class="detail-row">
            <span class="detail-label">PRIORITY</span>
            <select
              class="detail-select"
              value={props.card.priority}
              onChange={(e) => props.onEdit({ priority: e.currentTarget.value as Card["priority"] })}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          <div class="detail-row">
            <span class="detail-label">COLUMN</span>
            <select
              class="detail-select"
              value={props.card.column}
              onChange={(e) => props.onMove(e.currentTarget.value)}
            >
              <For each={props.columns}>
                {(col) => <option value={col}>{col}</option>}
              </For>
            </select>
          </div>

          <div class="detail-row">
            <span class="detail-label">DUE DATE</span>
            <input
              class="detail-input"
              type="date"
              value={props.card.due || ""}
              onChange={(e) => props.onEdit({ due: e.currentTarget.value || null as unknown as string })}
            />
          </div>

          <div class="detail-row">
            <span class="detail-label">TAGS</span>
            <input
              class="detail-input"
              type="text"
              value={props.card.tags.join(", ")}
              placeholder="tag1, tag2, ..."
              onChange={(e) =>
                props.onEdit({ tags: e.currentTarget.value.split(",").map((t) => t.trim()).filter(Boolean) })
              }
            />
          </div>

          <div class="detail-description">
            <span class="detail-label">DESCRIPTION</span>
            <Show
              when={editingDesc()}
              fallback={
                <div
                  class="desc-preview"
                  onClick={() => { setDescDraft(props.card.description); setEditingDesc(true); }}
                >
                  <Show
                    when={props.card.description}
                    fallback={<p class="desc-placeholder">Click to add a description...</p>}
                  >
                    <pre class="desc-content">{props.card.description}</pre>
                  </Show>
                </div>
              }
            >
              <div class="desc-editor">
                <textarea
                  class="desc-textarea"
                  value={descDraft()}
                  onInput={(e) => setDescDraft(e.currentTarget.value)}
                  rows={8}
                  autofocus
                />
                <div class="desc-actions">
                  <button
                    class="btn-primary btn-sm"
                    onClick={() => {
                      props.onSetDescription(descDraft());
                      setEditingDesc(false);
                    }}
                  >
                    Save
                  </button>
                  <button
                    class="btn-ghost btn-sm"
                    onClick={() => {
                      setDescDraft(props.card.description);
                      setEditingDesc(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-danger" onClick={props.onDelete}>Delete Card</button>
        </div>
      </div>
    </div>
  );
}
