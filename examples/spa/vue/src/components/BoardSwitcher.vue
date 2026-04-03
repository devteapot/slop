<script setup lang="ts">
import { ref } from "vue";
import type { Board } from "../types";

defineProps<{
  boards: Board[];
  activeBoardId: string;
}>();

const emit = defineEmits<{
  navigate: [boardId: string];
  createBoard: [name: string];
}>();

const creating = ref(false);
const newName = ref("");

function handleSubmit() {
  if (newName.value.trim()) {
    emit("createBoard", newName.value.trim());
    newName.value = "";
    creating.value = false;
  }
}
</script>

<template>
  <nav class="board-switcher">
    <button
      v-for="board in boards"
      :key="board.id"
      :class="['board-tab', { active: board.id === activeBoardId }]"
      @click="emit('navigate', board.id)"
    >
      {{ board.name }}
    </button>
    <span v-if="creating" class="board-tab-create">
      <input
        class="board-tab-input"
        type="text"
        placeholder="Board name..."
        v-model="newName"
        @keydown.enter="handleSubmit"
        autofocus
      />
      <button class="btn-ghost" @click="handleSubmit">&#10003;</button>
      <button class="btn-ghost" @click="creating = false">&times;</button>
    </span>
    <button v-else class="board-tab add" @click="creating = true">+</button>
  </nav>
</template>
