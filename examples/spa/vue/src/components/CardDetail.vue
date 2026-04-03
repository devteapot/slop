<script setup lang="ts">
import { ref } from "vue";
import type { Card } from "../types";

const props = defineProps<{
  card: Card;
  columns: string[];
}>();

const emit = defineEmits<{
  edit: [updates: Partial<Pick<Card, "title" | "priority" | "due" | "tags">>];
  move: [column: string];
  delete: [];
  setDescription: [content: string];
  close: [];
}>();

const editingDesc = ref(false);
const descDraft = ref(props.card.description);
const editingTitle = ref(false);
const titleDraft = ref(props.card.title);

function handleTitleBlur() {
  if (titleDraft.value.trim() && titleDraft.value !== props.card.title) {
    emit("edit", { title: titleDraft.value.trim() });
  }
  editingTitle.value = false;
}

function handleTitleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
  if (e.key === "Escape") {
    titleDraft.value = props.card.title;
    editingTitle.value = false;
  }
}
</script>

<template>
  <div class="modal-overlay" @click="emit('close')">
    <div class="modal" @click.stop>
      <div class="modal-header">
        <input
          v-if="editingTitle"
          class="modal-title-input"
          :value="titleDraft"
          @input="titleDraft = ($event.target as HTMLInputElement).value"
          @blur="handleTitleBlur"
          @keydown="handleTitleKeydown"
          autofocus
        />
        <h2 v-else class="modal-title" @click="editingTitle = true">{{ card.title }}</h2>
        <button class="modal-close" @click="emit('close')">&times;</button>
      </div>

      <div class="modal-body">
        <div class="detail-row">
          <span class="detail-label">PRIORITY</span>
          <select
            class="detail-select"
            :value="card.priority"
            @change="emit('edit', { priority: ($event.target as HTMLSelectElement).value as Card['priority'] })"
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
            :value="card.column"
            @change="emit('move', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="col in columns" :key="col" :value="col">{{ col }}</option>
          </select>
        </div>

        <div class="detail-row">
          <span class="detail-label">DUE DATE</span>
          <input
            class="detail-input"
            type="date"
            :value="card.due || ''"
            @change="emit('edit', { due: ($event.target as HTMLInputElement).value || (null as unknown as string) })"
          />
        </div>

        <div class="detail-row">
          <span class="detail-label">TAGS</span>
          <input
            class="detail-input"
            type="text"
            :value="card.tags.join(', ')"
            placeholder="tag1, tag2, ..."
            @change="emit('edit', { tags: ($event.target as HTMLInputElement).value.split(',').map((t) => t.trim()).filter(Boolean) })"
          />
        </div>

        <div class="detail-description">
          <span class="detail-label">DESCRIPTION</span>
          <div v-if="editingDesc" class="desc-editor">
            <textarea
              class="desc-textarea"
              :value="descDraft"
              @input="descDraft = ($event.target as HTMLTextAreaElement).value"
              rows="8"
              autofocus
            />
            <div class="desc-actions">
              <button
                class="btn-primary btn-sm"
                @click="emit('setDescription', descDraft); editingDesc = false"
              >
                Save
              </button>
              <button
                class="btn-ghost btn-sm"
                @click="descDraft = card.description; editingDesc = false"
              >
                Cancel
              </button>
            </div>
          </div>
          <div
            v-else
            class="desc-preview"
            @click="descDraft = card.description; editingDesc = true"
          >
            <pre v-if="card.description" class="desc-content">{{ card.description }}</pre>
            <p v-else class="desc-placeholder">Click to add a description...</p>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-danger" @click="emit('delete')">Delete Card</button>
      </div>
    </div>
  </div>
</template>
