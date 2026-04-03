<script setup lang="ts">
import { computed } from "vue";
import type { ItemDescriptor } from "@slop-ai/core";
import { action, useSlop } from "@slop-ai/vue";
import { slop } from "../slop";
import type { Card } from "../types";
import { computeSalience } from "../salience";
import CardItem from "./Card.vue";

const COLUMN_LABELS: Record<string, string> = {
  backlog: "Backlog",
  "in-progress": "In Progress",
  review: "Review",
  done: "Done",
  todo: "Todo",
  doing: "Doing",
};

const WINDOW_SIZE = 8;

const props = defineProps<{
  boardId: string;
  columnId: string;
  position: number;
  cards: Card[];
  allColumns: string[];
}>();

const emit = defineEmits<{
  moveCard: [cardId: string, column: string];
  editCard: [cardId: string, updates: Partial<Pick<Card, "title" | "priority" | "due" | "tags">>];
  deleteCard: [cardId: string];
  reorderCard: [column: string, cardId: string, position: number];
  setDescription: [cardId: string, content: string];
  openDetail: [cardId: string];
}>();

const sorted = computed(() => [...props.cards].sort((a, b) => a.position - b.position));
const total = computed(() => sorted.value.length);
const label = computed(() => COLUMN_LABELS[props.columnId] || props.columnId);

function buildItemDescriptor(card: Card) {
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
          emit("editCard", card.id, updates);
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
        ({ column }) => emit("moveCard", card.id, column),
      ),
      delete: action(() => emit("deleteCard", card.id), { dangerous: true }),
      set_description: action(
        { content: { type: "string", description: "Markdown content" } },
        ({ content }) => emit("setDescription", card.id, content),
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

// SLOP: collection descriptor
useSlop(slop, () => `${props.boardId}/${props.columnId}`, () => {
  const windowed = sorted.value.slice(0, WINDOW_SIZE);
  const useWindow = total.value > WINDOW_SIZE;

  if (useWindow) {
    return {
      type: "collection",
      props: { name: label.value, position: props.position, card_count: total.value },
      window: {
        items: windowed.map(buildItemDescriptor),
        total: total.value,
        offset: 0,
      },
      actions: {
        reorder: action(
          { card_id: "string", position: "number" },
          ({ card_id, position }) => emit("reorderCard", props.columnId, card_id, position),
        ),
      },
    };
  }

  return {
    type: "collection",
    props: { name: label.value, position: props.position, card_count: total.value },
    meta: { window: [0, total.value] as [number, number], total_children: total.value },
    items: sorted.value.map(buildItemDescriptor),
    actions: {
      reorder: action(
        { card_id: "string", position: "number" },
        ({ card_id, position }) => emit("reorderCard", props.columnId, card_id, position),
      ),
    },
  };
});
</script>

<template>
  <section class="column">
    <div class="column-header">
      <h2 class="column-title">{{ label }}</h2>
      <span class="column-count">{{ total }}</span>
    </div>
    <div class="column-cards">
      <CardItem
        v-for="card in sorted"
        :key="card.id"
        :card="card"
        :allColumns="allColumns"
        @move="(cardId, col) => emit('moveCard', cardId, col)"
        @delete="(cardId) => emit('deleteCard', cardId)"
        @openDetail="(cardId) => emit('openDetail', cardId)"
      />
      <p v-if="total === 0" class="column-empty">No cards</p>
    </div>
  </section>
</template>
