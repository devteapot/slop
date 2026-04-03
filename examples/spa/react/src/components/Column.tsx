import type { ItemDescriptor } from "@slop-ai/core";
import { action, useSlop } from "@slop-ai/react";
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

export default function Column({
  boardId,
  columnId,
  position,
  cards,
  allColumns,
  onMoveCard,
  onEditCard,
  onDeleteCard,
  onReorderCard,
  onSetDescription,
  onOpenDetail,
}: Props) {
  const sorted = [...cards].sort((a, b) => a.position - b.position);
  const windowed = sorted.slice(0, WINDOW_SIZE);
  const total = sorted.length;
  const useWindow = total > WINDOW_SIZE;
  const label = COLUMN_LABELS[columnId] || columnId;

  const buildItemDescriptor = (card: Card) => {
    const sal = computeSalience(card);
    const otherColumns = allColumns.filter((c) => c !== card.column);

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
            onEditCard(card.id, updates);
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
          ({ column }) => onMoveCard(card.id, column),
        ),
        delete: action(() => onDeleteCard(card.id), { dangerous: true }),
        set_description: action(
          { content: { type: "string", description: "Markdown content" } },
          ({ content }) => onSetDescription(card.id, content),
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

  useSlop(slop, () => `${boardId}/${columnId}`, () => (
    useWindow
      ? {
        type: "collection",
        props: { name: label, position, card_count: total },
        window: {
          items: windowed.map(buildItemDescriptor),
          total,
          offset: 0,
        },
        actions: {
          reorder: action(
            { card_id: "string", position: "number" },
            ({ card_id, position }) => onReorderCard(columnId, card_id, position),
          ),
        },
      }
      : {
        type: "collection",
        props: { name: label, position, card_count: total },
        meta: { window: [0, total] as [number, number], total_children: total },
        items: sorted.map(buildItemDescriptor),
        actions: {
          reorder: action(
            { card_id: "string", position: "number" },
            ({ card_id, position }) => onReorderCard(columnId, card_id, position),
          ),
        },
      }
  ));

  return (
    <section className="column">
      <div className="column-header">
        <h2 className="column-title">{label}</h2>
        <span className="column-count">{total}</span>
      </div>
      <div className="column-cards">
        {sorted.map((card) => (
          <CardItem
            key={card.id}
            card={card}
            allColumns={allColumns}
            onMove={onMoveCard}
            onDelete={onDeleteCard}
            onOpenDetail={onOpenDetail}
          />
        ))}
        {total === 0 && <p className="column-empty">No cards</p>}
      </div>
    </section>
  );
}
