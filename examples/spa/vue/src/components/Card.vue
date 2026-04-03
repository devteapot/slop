<script setup lang="ts">
import { ref } from "vue";
import type { Card } from "../types";
import { computeSalience } from "../salience";

const PRIORITY_LABELS: Record<string, string> = {
  critical: "CRIT",
  high: "HIGH",
  medium: "MED",
  low: "LOW",
};

const props = defineProps<{
  card: Card;
  allColumns: string[];
}>();

const emit = defineEmits<{
  move: [cardId: string, column: string];
  delete: [cardId: string];
  openDetail: [cardId: string];
}>();

const showMenu = ref(false);

const sal = computeSalience(props.card);
const otherColumns = props.allColumns.filter((c) => c !== props.card.column);
const isOverdue = props.card.due && new Date(props.card.due) < new Date() && props.card.column !== "done";

function formatDue(due: string) {
  const date = new Date(due);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
</script>

<template>
  <div
    :class="['card', { 'card-pinned': sal.pinned, 'card-overdue': isOverdue }]"
    @click="emit('openDetail', card.id)"
  >
    <div class="card-header">
      <span :class="['card-priority', `priority-${card.priority}`]">
        {{ PRIORITY_LABELS[card.priority] }}
      </span>
      <button
        class="card-menu-btn"
        @click.stop="showMenu = !showMenu"
      >
        &#8942;
      </button>
    </div>

    <h3 class="card-title">{{ card.title }}</h3>

    <div class="card-footer">
      <span v-if="card.due" :class="['card-due', { overdue: isOverdue }]">
        {{ formatDue(card.due) }}
      </span>
      <div v-if="card.tags.length > 0" class="card-tags">
        <span v-for="tag in card.tags" :key="tag" class="card-tag">{{ tag }}</span>
      </div>
      <span v-if="card.description" class="card-has-desc">&#9776;</span>
    </div>

    <div v-if="showMenu" class="card-menu" @click.stop>
      <button
        v-for="col in otherColumns"
        :key="col"
        class="card-menu-item"
        @click="emit('move', card.id, col); showMenu = false"
      >
        Move to {{ col }}
      </button>
      <button
        class="card-menu-item danger"
        @click="emit('delete', card.id); showMenu = false"
      >
        Delete
      </button>
    </div>
  </div>
</template>
