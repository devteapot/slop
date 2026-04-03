<script setup lang="ts">
import { ref } from "vue";
import type { Card } from "../types";

const props = defineProps<{
  columns: string[];
}>();

const emit = defineEmits<{
  submit: [
    title: string,
    column: string | undefined,
    priority: Card["priority"] | undefined,
    due: string | undefined,
    description: string | undefined,
    tags: string[] | undefined,
  ];
  close: [];
}>();

const title = ref("");
const column = ref(props.columns[0] || "");
const priority = ref<Card["priority"]>("medium");
const due = ref("");
const tags = ref("");

function handleSubmit() {
  if (!title.value.trim()) return;
  emit(
    "submit",
    title.value.trim(),
    column.value,
    priority.value,
    due.value || undefined,
    undefined,
    tags.value ? tags.value.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
  );
}
</script>

<template>
  <div class="modal-overlay" @click="emit('close')">
    <div class="modal" @click.stop>
      <div class="modal-header">
        <h2 class="modal-title">New Card</h2>
        <button class="modal-close" @click="emit('close')">&times;</button>
      </div>

      <div class="modal-body">
        <div class="form-field">
          <label class="form-label">TITLE</label>
          <input
            class="form-input"
            type="text"
            v-model="title"
            @keydown.enter="handleSubmit"
            placeholder="Card title..."
            autofocus
          />
        </div>

        <div class="form-row">
          <div class="form-field">
            <label class="form-label">COLUMN</label>
            <select class="form-select" v-model="column">
              <option v-for="col in columns" :key="col" :value="col">{{ col }}</option>
            </select>
          </div>

          <div class="form-field">
            <label class="form-label">PRIORITY</label>
            <select class="form-select" v-model="priority">
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
            <input class="form-input" type="date" v-model="due" />
          </div>

          <div class="form-field">
            <label class="form-label">TAGS</label>
            <input
              class="form-input"
              type="text"
              v-model="tags"
              placeholder="tag1, tag2, ..."
            />
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-ghost" @click="emit('close')">Cancel</button>
        <button class="btn-primary" @click="handleSubmit" :disabled="!title.trim()">
          Create
        </button>
      </div>
    </div>
  </div>
</template>
