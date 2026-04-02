<script lang="ts">
  import type { Card } from "../types";

  let { columns, onSubmit, onClose }: {
    columns: string[];
    onSubmit: (
      title: string,
      column?: string,
      priority?: Card["priority"],
      due?: string,
      description?: string,
      tags?: string[],
    ) => void;
    onClose: () => void;
  } = $props();

  let title = $state("");
  let column = $state("");
  let priority = $state<Card["priority"]>("medium");
  let due = $state("");
  let tags = $state("");

  $effect(() => {
    const nextColumn = columns[0] || "";
    if (!columns.includes(column)) {
      column = nextColumn;
    }
  });

  function handleSubmit() {
    if (!title.trim()) return;
    onSubmit(
      title.trim(),
      column,
      priority,
      due || undefined,
      undefined,
      tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    );
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={onClose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2 class="modal-title">New Card</h2>
      <button class="modal-close" onclick={onClose}>&times;</button>
    </div>

    <div class="modal-body">
      <div class="form-field">
        <label class="form-label">TITLE</label>
        <input
          class="form-input"
          type="text"
          bind:value={title}
          onkeydown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="Card title..."
          autofocus
        />
      </div>

      <div class="form-row">
        <div class="form-field">
          <label class="form-label">COLUMN</label>
          <select class="form-select" bind:value={column}>
            {#each columns as col (col)}
              <option value={col}>{col}</option>
            {/each}
          </select>
        </div>

        <div class="form-field">
          <label class="form-label">PRIORITY</label>
          <select class="form-select" bind:value={priority}>
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
          <input class="form-input" type="date" bind:value={due} />
        </div>

        <div class="form-field">
          <label class="form-label">TAGS</label>
          <input
            class="form-input"
            type="text"
            bind:value={tags}
            placeholder="tag1, tag2, ..."
          />
        </div>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn-ghost" onclick={onClose}>Cancel</button>
      <button class="btn-primary" onclick={handleSubmit} disabled={!title.trim()}>
        Create
      </button>
    </div>
  </div>
</div>
