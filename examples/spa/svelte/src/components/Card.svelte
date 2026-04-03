<script lang="ts">
  import type { Card } from "../types";
  import { computeSalience } from "../salience";

  const PRIORITY_LABELS: Record<string, string> = {
    critical: "CRIT",
    high: "HIGH",
    medium: "MED",
    low: "LOW",
  };

  let { card, allColumns, onMove, onDelete, onOpenDetail }: {
    card: Card;
    allColumns: string[];
    onMove: (cardId: string, column: string) => void;
    onDelete: (cardId: string) => void;
    onOpenDetail: (cardId: string) => void;
  } = $props();

  let showMenu = $state(false);
  let sal = $derived(computeSalience(card));
  let otherColumns = $derived(allColumns.filter((c) => c !== card.column));
  let isOverdue = $derived(card.due && new Date(card.due) < new Date() && card.column !== "done");

  function formatDue(due: string) {
    const date = new Date(due);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
</script>

<div
  class="card {sal.pinned ? 'card-pinned' : ''} {isOverdue ? 'card-overdue' : ''}"
  onclick={() => onOpenDetail(card.id)}
  role="button"
  tabindex="0"
  onkeydown={(e) => e.key === "Enter" && onOpenDetail(card.id)}
>
  <div class="card-header">
    <span class="card-priority priority-{card.priority}">
      {PRIORITY_LABELS[card.priority]}
    </span>
    <button
      class="card-menu-btn"
      onclick={(e) => {
        e.stopPropagation();
        showMenu = !showMenu;
      }}
    >
      &#8942;
    </button>
  </div>

  <h3 class="card-title">{card.title}</h3>

  <div class="card-footer">
    {#if card.due}
      <span class="card-due {isOverdue ? 'overdue' : ''}">
        {formatDue(card.due)}
      </span>
    {/if}
    {#if card.tags.length > 0}
      <div class="card-tags">
        {#each card.tags as tag (tag)}
          <span class="card-tag">{tag}</span>
        {/each}
      </div>
    {/if}
    {#if card.description}
      <span class="card-has-desc">&#9776;</span>
    {/if}
  </div>

  {#if showMenu}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="card-menu" onclick={(e) => e.stopPropagation()}>
      {#each otherColumns as col (col)}
        <button
          class="card-menu-item"
          onclick={() => {
            onMove(card.id, col);
            showMenu = false;
          }}
        >
          Move to {col}
        </button>
      {/each}
      <button
        class="card-menu-item danger"
        onclick={() => {
          onDelete(card.id);
          showMenu = false;
        }}
      >
        Delete
      </button>
    </div>
  {/if}
</div>
