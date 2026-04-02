<script lang="ts">
  import type { Card } from "../types";

  let { card, columns, onEdit, onMove, onDelete, onSetDescription, onClose }: {
    card: Card;
    columns: string[];
    onEdit: (updates: Partial<Pick<Card, "title" | "priority" | "due" | "tags">>) => void;
    onMove: (column: string) => void;
    onDelete: () => void;
    onSetDescription: (content: string) => void;
    onClose: () => void;
  } = $props();

  let editingDesc = $state(false);
  let descDraft = $state(card.description);
  let editingTitle = $state(false);
  let titleDraft = $state(card.title);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={onClose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      {#if editingTitle}
        <input
          class="modal-title-input"
          value={titleDraft}
          oninput={(e) => (titleDraft = e.currentTarget.value)}
          onblur={() => {
            if (titleDraft.trim() && titleDraft !== card.title) {
              onEdit({ title: titleDraft.trim() });
            }
            editingTitle = false;
          }}
          onkeydown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") { titleDraft = card.title; editingTitle = false; }
          }}
          autofocus
        />
      {:else}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <h2 class="modal-title" onclick={() => (editingTitle = true)}>{card.title}</h2>
      {/if}
      <button class="modal-close" onclick={onClose}>&times;</button>
    </div>

    <div class="modal-body">
      <div class="detail-row">
        <span class="detail-label">PRIORITY</span>
        <select
          class="detail-select"
          value={card.priority}
          onchange={(e) => onEdit({ priority: e.currentTarget.value as Card["priority"] })}
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
          value={card.column}
          onchange={(e) => onMove(e.currentTarget.value)}
        >
          {#each columns as col (col)}
            <option value={col}>{col}</option>
          {/each}
        </select>
      </div>

      <div class="detail-row">
        <span class="detail-label">DUE DATE</span>
        <input
          class="detail-input"
          type="date"
          value={card.due || ""}
          onchange={(e) => onEdit({ due: e.currentTarget.value || (null as unknown as string) })}
        />
      </div>

      <div class="detail-row">
        <span class="detail-label">TAGS</span>
        <input
          class="detail-input"
          type="text"
          value={card.tags.join(", ")}
          placeholder="tag1, tag2, ..."
          oninput={(e) =>
            onEdit({ tags: e.currentTarget.value.split(",").map((t) => t.trim()).filter(Boolean) })
          }
        />
      </div>

      <div class="detail-description">
        <span class="detail-label">DESCRIPTION</span>
        {#if editingDesc}
          <div class="desc-editor">
            <textarea
              class="desc-textarea"
              value={descDraft}
              oninput={(e) => (descDraft = e.currentTarget.value)}
              rows={8}
              autofocus
            ></textarea>
            <div class="desc-actions">
              <button
                class="btn-primary btn-sm"
                onclick={() => {
                  onSetDescription(descDraft);
                  editingDesc = false;
                }}
              >
                Save
              </button>
              <button
                class="btn-ghost btn-sm"
                onclick={() => {
                  descDraft = card.description;
                  editingDesc = false;
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        {:else}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="desc-preview"
            onclick={() => { descDraft = card.description; editingDesc = true; }}
          >
            {#if card.description}
              <pre class="desc-content">{card.description}</pre>
            {:else}
              <p class="desc-placeholder">Click to add a description...</p>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn-danger" onclick={onDelete}>Delete Card</button>
    </div>
  </div>
</div>
