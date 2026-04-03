<script lang="ts">
  let { query, onQueryChange }: {
    query: string;
    onQueryChange: (query: string) => void;
  } = $props();
</script>

<div class="search-bar">
  <input
    type="text"
    placeholder="Search cards..."
    value={query}
    oninput={(e) => onQueryChange(e.currentTarget.value)}
  />
  {#if query}
    <button class="search-clear" onclick={() => onQueryChange("")}>
      &times;
    </button>
  {/if}
</div>
