import { For, Show } from "solid-js";
import type { ItemDescriptor } from "@slop-ai/core";
import { action, useSlop } from "@slop-ai/solid";
import { slop } from "../slop";
import type { Card } from "../types";
import { computeSalience } from "../salience";
import CardItem from "./Card";

const COLUMN_LABELS: Record<string, string> = {
  backlog: "Backlog",
  "in-progress": "In Progress",
  review: "Review",
  done: "Done",
  todo: "Todo",
  doing: "Doing",
};

const WINDOW_SIZE = 8;

interface Props {
  boardId: string;
  columnId: string;
  position: number;
  cards: Card[];
  allColumns: string[];
  onMoveCard: (cardId: string, column: string) => void;
  onEditCard: (cardId: string, updates: Partial<Pick<Card, "title" | "priority" | "due" | "tags">>) => void;
  onDeleteCard: (cardId: string) => void;
  onReorderCard: (column: string, cardId: string, position: number) => void;
  onSetDescription: (cardId: string, content: string) => void;
  onOpenDetail: (cardId: string) => void;
}

export default function Column(props: Props) {
  const sorted = () => [...props.cards].sort((a, b) => a.position - b.position);
  const total = () => sorted().length;
  const label = () => COLUMN_LABELS[props.columnId] || props.columnId;

  const buildItemDescriptor = (card: Card) => {
    const sal = computeSalience(card);
    const otherColumns = props.allColumns.filter((c) => c !== card.column);

    const descriptor: ItemDescriptor = {
      id: card.id,
      props: {
        title: card.title,
        priority: card.priority,
        tags: card.tags,
        due: card.due,
        column: card.column,
      },
      meta: {
        salience: sal.salience,
        urgency: sal.urgency,
        reason: sal.reason,
        ...(sal.pinned ? { pinned: true } : {}),
      },
      actions: {
        edit: action(
          {
            title: { type: "string" },
            priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
            due: { type: "string", description: "ISO date string" },
            tags: { type: "string", description: "Comma-separated tags" },
          },
          ({ title, priority, due, tags }) => {
            const updates: Partial<Pick<Card, "title" | "priority" | "due" | "tags">> = {};
            if (title) updates.title = title;
            if (priority) updates.priority = priority as Card["priority"];
            if (due) updates.due = due;
            if (tags) {
              updates.tags = tags.split(",").map((t) => t.trim()).filter(Boolean);
            }
            props.onEditCard(card.id, updates);
          },
          { idempotent: true },
        ),
        move: action(
          {
            column: {
              type: "string",
              description: `Target column. One of: ${otherColumns.join(", ")}`,
            },
          },
          ({ column }) => props.onMoveCard(card.id, column),
        ),
        delete: action(() => props.onDeleteCard(card.id), { dangerous: true }),
        set_description: action(
          { content: { type: "string", description: "Markdown content" } },
          ({ content }) => props.onSetDescription(card.id, content),
        ),
      },
    };

    if (card.description) {
      descriptor.contentRef = {
        type: "text" as const,
        mime: "text/markdown",
        size: card.description.length,
        summary: card.description.slice(0, 80).replace(/\n/g, " "),
        preview: card.description.slice(0, 200),
      };
    }

    return descriptor;
  };

  useSlop(slop, () => `${props.boardId}/${props.columnId}`, () => {
    const s = sorted();
    const t = total();
    const windowed = s.slice(0, WINDOW_SIZE);
    const useWindow = t > WINDOW_SIZE;

    if (useWindow) {
      return {
        type: "collection",
        props: { name: label(), position: props.position, card_count: t },
        window: {
          items: windowed.map(buildItemDescriptor),
          total: t,
          offset: 0,
        },
        actions: {
          reorder: action(
            { card_id: "string", position: "number" },
            ({ card_id, position }) => props.onReorderCard(props.columnId, card_id, position),
          ),
        },
      };
    }

    return {
      type: "collection",
      props: { name: label(), position: props.position, card_count: t },
      meta: { window: [0, t] as [number, number], total_children: t },
      items: s.map(buildItemDescriptor),
      actions: {
        reorder: action(
          { card_id: "string", position: "number" },
          ({ card_id, position }) => props.onReorderCard(props.columnId, card_id, position),
        ),
      },
    };
  });

  return (
    <section class="column">
      <div class="column-header">
        <h2 class="column-title">{label()}</h2>
        <span class="column-count">{total()}</span>
      </div>
      <div class="column-cards">
        <For each={sorted()}>
          {(card) => (
            <CardItem
              card={card}
              allColumns={props.allColumns}
              onMove={props.onMoveCard}
              onDelete={props.onDeleteCard}
              onOpenDetail={props.onOpenDetail}
            />
          )}
        </For>
        <Show when={total() === 0}>
          <p class="column-empty">No cards</p>
        </Show>
      </div>
    </section>
  );
}
