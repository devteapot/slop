<script lang="ts">
  import type { Board } from "../types";

  let { boards, activeBoardId, onNavigate, onCreateBoard }: {
    boards: Board[];
    activeBoardId: string;
    onNavigate: (boardId: string) => void;
    onCreateBoard: (name: string) => void;
  } = $props();

  let creating = $state(false);
  let newName = $state("");

  function handleSubmit() {
    if (newName.trim()) {
      onCreateBoard(newName.trim());
      newName = "";
      creating = false;
    }
  }
</script>

<nav class="board-switcher">
  {#each boards as board (board.id)}
    <button
      class="board-tab {board.id === activeBoardId ? 'active' : ''}"
      onclick={() => onNavigate(board.id)}
    >
      {board.name}
    </button>
  {/each}
  {#if creating}
    <span class="board-tab-create">
      <input
        class="board-tab-input"
        type="text"
        placeholder="Board name..."
        bind:value={newName}
        onkeydown={(e) => e.key === "Enter" && handleSubmit()}
        autofocus
      />
      <button class="btn-ghost" onclick={handleSubmit}>&#10003;</button>
      <button class="btn-ghost" onclick={() => (creating = false)}>&times;</button>
    </span>
  {:else}
    <button class="board-tab add" onclick={() => (creating = true)}>+</button>
  {/if}
</nav>
