<script lang="ts">
  import type { ItemDescriptor } from "@slop-ai/core";
  import { slop } from "../slop";
  import { action, useSlop } from "@slop-ai/svelte";
  import type { Card } from "../types";
  import { computeSalience } from "../salience";
  import CardItem from "./Card.svelte";

  const COLUMN_LABELS: Record<string, string> = {
    backlog: "Backlog",
    "in-progress": "In Progress",
    review: "Review",
    done: "Done",
    todo: "Todo",
    doing: "Doing",
  };

  const WINDOW_SIZE = 8;

  let {
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
  }: {
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
  } = $props();

  let sorted = $derived([...cards].sort((a, b) => a.position - b.position));
  let windowed = $derived(sorted.slice(0, WINDOW_SIZE));
  let total = $derived(sorted.length);
  let useWindow = $derived(total > WINDOW_SIZE);
  let label = $derived(COLUMN_LABELS[columnId] || columnId);

  function buildItemDescriptor(card: Card) {
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
  }

  // SLOP: register column as collection
  useSlop(slop, () => `${boardId}/${columnId}`, () => {
    if (useWindow) {
      return {
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
      };
    }
    return {
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
    };
  });
</script>

<section class="column">
  <div class="column-header">
    <h2 class="column-title">{label}</h2>
    <span class="column-count">{total}</span>
  </div>
  <div class="column-cards">
    {#each sorted as card (card.id)}
      <CardItem
        {card}
        {allColumns}
        onMove={onMoveCard}
        onDelete={onDeleteCard}
        {onOpenDetail}
      />
    {/each}
    {#if total === 0}
      <p class="column-empty">No cards</p>
    {/if}
  </div>
</section>
