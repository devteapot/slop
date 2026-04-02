import { createSignal, Show, For } from "solid-js";
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

export default function CardItem(props: Props) {
  const [showMenu, setShowMenu] = createSignal(false);
  const sal = () => computeSalience(props.card);
  const otherColumns = () => props.allColumns.filter((c) => c !== props.card.column);
  const isOverdue = () => props.card.due && new Date(props.card.due) < new Date() && props.card.column !== "done";

  const formatDue = (due: string) => {
    const date = new Date(due);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div
      class={`card ${sal().pinned ? "card-pinned" : ""} ${isOverdue() ? "card-overdue" : ""}`}
      onClick={() => props.onOpenDetail(props.card.id)}
    >
      <div class="card-header">
        <span class={`card-priority priority-${props.card.priority}`}>
          {PRIORITY_LABELS[props.card.priority]}
        </span>
        <button
          class="card-menu-btn"
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu());
          }}
        >
          &#8942;
        </button>
      </div>

      <h3 class="card-title">{props.card.title}</h3>

      <div class="card-footer">
        <Show when={props.card.due}>
          <span class={`card-due ${isOverdue() ? "overdue" : ""}`}>
            {formatDue(props.card.due!)}
          </span>
        </Show>
        <Show when={props.card.tags.length > 0}>
          <div class="card-tags">
            <For each={props.card.tags}>
              {(tag) => <span class="card-tag">{tag}</span>}
            </For>
          </div>
        </Show>
        <Show when={props.card.description}>
          <span class="card-has-desc">&#9776;</span>
        </Show>
      </div>

      <Show when={showMenu()}>
        <div class="card-menu" onClick={(e) => e.stopPropagation()}>
          <For each={otherColumns()}>
            {(col) => (
              <button
                class="card-menu-item"
                onClick={() => {
                  props.onMove(props.card.id, col);
                  setShowMenu(false);
                }}
              >
                Move to {col}
              </button>
            )}
          </For>
          <button
            class="card-menu-item danger"
            onClick={() => {
              props.onDelete(props.card.id);
              setShowMenu(false);
            }}
          >
            Delete
          </button>
        </div>
      </Show>
    </div>
  );
}
