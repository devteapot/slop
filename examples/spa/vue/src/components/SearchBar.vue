<script setup lang="ts">
defineProps<{
  query: string;
}>();

const emit = defineEmits<{
  "update:query": [query: string];
}>();
</script>

<template>
  <div class="search-bar">
    <input
      type="text"
      placeholder="Search cards..."
      :value="query"
      @input="emit('update:query', ($event.target as HTMLInputElement).value)"
    />
    <button v-if="query" class="search-clear" @click="emit('update:query', '')">
      &times;
    </button>
  </div>
</template>
