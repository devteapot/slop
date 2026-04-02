import { For, Show } from "solid-js";
import { useSlop } from "@slop-ai/solid";
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

    const descriptor: Record<string, unknown> = {
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
        edit: {
          params: {
            title: { type: "string" },
            priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
            due: { type: "string", description: "ISO date string" },
            tags: { type: "string", description: "Comma-separated tags" },
          },
          idempotent: true,
          handler: (params: Record<string, unknown>) => {
            const updates: Partial<Pick<Card, "title" | "priority" | "due" | "tags">> = {};
            if (params.title) updates.title = params.title as string;
            if (params.priority) updates.priority = params.priority as Card["priority"];
            if (params.due) updates.due = params.due as string;
            if (params.tags) {
              updates.tags = typeof params.tags === "string"
                ? params.tags.split(",").map((t) => t.trim()).filter(Boolean)
                : params.tags as string[];
            }
            props.onEditCard(card.id, updates);
          },
        },
        move: {
          params: {
            column: {
              type: "string",
              description: `Target column. One of: ${otherColumns.join(", ")}`,
            },
          },
          handler: ({ column }: Record<string, unknown>) => props.onMoveCard(card.id, column as string),
        },
        delete: {
          dangerous: true,
          handler: () => props.onDeleteCard(card.id),
        },
        set_description: {
          params: { content: { type: "string", description: "Markdown content" } },
          handler: ({ content }: Record<string, unknown>) =>
            props.onSetDescription(card.id, content as string),
        },
      },
    };

    if (card.description) {
      (descriptor as Record<string, unknown>).contentRef = {
        type: "text" as const,
        mime: "text/markdown",
        size: card.description.length,
        summary: card.description.slice(0, 80).replace(/\n/g, " "),
        preview: card.description.slice(0, 200),
      };
    }

    return descriptor;
  };

  useSlop(slop, `${props.boardId}/${props.columnId}`, () => {
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
          reorder: {
            params: { card_id: "string", position: "number" },
            handler: ({ card_id, position: pos }: Record<string, unknown>) =>
              props.onReorderCard(props.columnId, card_id as string, pos as number),
          },
        },
      };
    }

    return {
      type: "collection",
      props: { name: label(), position: props.position, card_count: t },
      meta: { window: [0, t] as [number, number], total_children: t },
      items: s.map(buildItemDescriptor),
      actions: {
        reorder: {
          params: { card_id: "string", position: "number" },
          handler: ({ card_id, position: pos }: Record<string, unknown>) =>
            props.onReorderCard(props.columnId, card_id as string, pos as number),
        },
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
