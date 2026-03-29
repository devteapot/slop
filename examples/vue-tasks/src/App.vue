<script setup lang="ts">
import { ref } from "vue";
import { useSlop } from "@slop-ai/vue";
import { slop } from "./slop";

interface Task {
  id: string;
  title: string;
  done: boolean;
  category: string;
}

const tasks = ref<Task[]>([
  { id: "1", title: "Read SLOP spec", done: false, category: "learning" },
  { id: "2", title: "Build Vue demo", done: true, category: "dev" },
]);

const newTitle = ref("");
const newCategory = ref("general");
let nextId = 3;

function addTask(title: string, category = "general") {
  tasks.value.push({ id: String(nextId++), title, done: false, category });
}

function toggleTask(id: string) {
  const t = tasks.value.find((t) => t.id === id);
  if (t) t.done = !t.done;
}

function deleteTask(id: string) {
  tasks.value = tasks.value.filter((t) => t.id !== id);
}

useSlop(slop, "tasks", () => ({
  type: "collection" as const,
  props: { count: tasks.value.length },
  actions: {
    create: {
      params: { title: "string" as const, category: "string" as const },
      handler: (p: { title: string; category?: string }) =>
        addTask(p.title, p.category),
    },
  },
  items: tasks.value.map((t) => ({
    id: t.id,
    props: { title: t.title, done: t.done, category: t.category },
    actions: {
      toggle: { handler: () => toggleTask(t.id) },
      delete: { handler: () => deleteTask(t.id) },
    },
  })),
}));

function onSubmit() {
  const title = newTitle.value.trim();
  if (!title) return;
  addTask(title, newCategory.value || "general");
  newTitle.value = "";
}
</script>

<template>
  <div :style="{ maxWidth: '520px', margin: '0 auto', padding: '2rem 1rem' }">
    <h1 :style="{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }">
      Task Manager
    </h1>

    <!-- Add form -->
    <form
      @submit.prevent="onSubmit"
      :style="{
        display: 'flex',
        gap: '0.5rem',
        marginBottom: '1.5rem',
      }"
    >
      <input
        v-model="newTitle"
        placeholder="New task..."
        :style="{
          flex: 1,
          padding: '0.5rem 0.75rem',
          background: '#1c1f26',
          border: '1px solid #30363d',
          borderRadius: '6px',
          color: '#e1e4e8',
          fontSize: '0.875rem',
        }"
      />
      <select
        v-model="newCategory"
        :style="{
          padding: '0.5rem',
          background: '#1c1f26',
          border: '1px solid #30363d',
          borderRadius: '6px',
          color: '#e1e4e8',
          fontSize: '0.875rem',
        }"
      >
        <option value="general">general</option>
        <option value="dev">dev</option>
        <option value="learning">learning</option>
        <option value="chore">chore</option>
      </select>
      <button
        type="submit"
        :style="{
          padding: '0.5rem 1rem',
          background: '#238636',
          border: 'none',
          borderRadius: '6px',
          color: '#fff',
          fontWeight: 600,
          cursor: 'pointer',
          fontSize: '0.875rem',
        }"
      >
        Add
      </button>
    </form>

    <!-- Task list -->
    <div v-if="tasks.length === 0" :style="{ color: '#6e7681', textAlign: 'center', padding: '2rem' }">
      No tasks yet.
    </div>
    <ul :style="{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }">
      <li
        v-for="task in tasks"
        :key="task.id"
        :style="{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.625rem 0.75rem',
          background: '#1c1f26',
          border: '1px solid #30363d',
          borderRadius: '6px',
        }"
      >
        <input
          type="checkbox"
          :checked="task.done"
          @change="toggleTask(task.id)"
          :style="{ cursor: 'pointer' }"
        />
        <span
          :style="{
            flex: 1,
            textDecoration: task.done ? 'line-through' : 'none',
            opacity: task.done ? 0.5 : 1,
          }"
        >
          {{ task.title }}
        </span>
        <span
          :style="{
            fontSize: '0.75rem',
            padding: '0.125rem 0.5rem',
            background: '#30363d',
            borderRadius: '9999px',
            color: '#8b949e',
          }"
        >
          {{ task.category }}
        </span>
        <button
          @click="deleteTask(task.id)"
          :style="{
            background: 'none',
            border: 'none',
            color: '#f85149',
            cursor: 'pointer',
            fontSize: '1rem',
            padding: '0 0.25rem',
          }"
        >
          x
        </button>
      </li>
    </ul>
  </div>
</template>
