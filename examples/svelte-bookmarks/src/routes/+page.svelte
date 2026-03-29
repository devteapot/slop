<script lang="ts">
  import { onDestroy } from "svelte";
  import { slop } from "$lib/slop";

  interface Bookmark {
    id: string;
    title: string;
    url: string;
    tags: string[];
  }

  let bookmarks = $state<Bookmark[]>([
    { id: "1", title: "Svelte 5 Docs", url: "https://svelte.dev/docs", tags: ["docs", "svelte"] },
    { id: "2", title: "SLOP Protocol", url: "https://slopai.dev", tags: ["slop", "ai"] },
  ]);

  let newTitle = $state("");
  let newUrl = $state("");
  let nextId = 3;

  function addBookmark(title: string, url: string) {
    bookmarks.push({ id: String(nextId++), title, url, tags: [] });
  }

  function deleteBookmark(id: string) {
    bookmarks = bookmarks.filter((b) => b.id !== id);
  }

  function addTag(id: string, tag: string) {
    const bm = bookmarks.find((b) => b.id === id);
    if (bm && !bm.tags.includes(tag)) bm.tags.push(tag);
  }

  function handleAdd() {
    if (!newTitle.trim() || !newUrl.trim()) return;
    addBookmark(newTitle.trim(), newUrl.trim());
    newTitle = "";
    newUrl = "";
  }

  // --- SLOP integration ---
  $effect(() => {
    slop.register("bookmarks", {
      type: "collection",
      props: { count: bookmarks.length },
      actions: {
        add: {
          params: { title: "string", url: "string" },
          handler: (p: Record<string, unknown>) => {
            addBookmark(p.title as string, p.url as string);
          },
        },
      },
      items: bookmarks.map((b) => ({
        id: b.id,
        props: { title: b.title, url: b.url, tags: b.tags },
        actions: {
          delete: {
            handler: () => deleteBookmark(b.id),
          },
          add_tag: {
            params: { tag: "string" },
            handler: (p: Record<string, unknown>) => addTag(b.id, p.tag as string),
          },
        },
      })),
    });
  });

  onDestroy(() => slop.unregister("bookmarks"));
</script>

<main>
  <h1>Bookmarks</h1>

  <form onsubmit={handleAdd} class="add-form">
    <input bind:value={newTitle} placeholder="Title" />
    <input bind:value={newUrl} placeholder="https://..." />
    <button type="submit">Add</button>
  </form>

  {#if bookmarks.length === 0}
    <p class="empty">No bookmarks yet.</p>
  {:else}
    <ul>
      {#each bookmarks as bm (bm.id)}
        <li>
          <div class="bm-header">
            <a href={bm.url} target="_blank" rel="noopener">{bm.title}</a>
            <button class="delete" onclick={() => deleteBookmark(bm.id)}>x</button>
          </div>
          <span class="url">{bm.url}</span>
          {#if bm.tags.length > 0}
            <div class="tags">
              {#each bm.tags as tag}
                <span class="tag">{tag}</span>
              {/each}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  main {
    max-width: 600px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  h1 {
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 1.5rem;
  }

  .add-form {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }

  input {
    flex: 1;
    padding: 0.5rem 0.75rem;
    background: #1a1d27;
    border: 1px solid #2d3139;
    border-radius: 6px;
    color: #e1e4e8;
    font-size: 0.875rem;
  }

  input::placeholder {
    color: #6b737e;
  }

  button {
    padding: 0.5rem 1rem;
    background: #238636;
    border: none;
    border-radius: 6px;
    color: #fff;
    font-size: 0.875rem;
    cursor: pointer;
  }

  button:hover {
    background: #2ea043;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  li {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 8px;
    padding: 0.75rem 1rem;
  }

  .bm-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  a {
    color: #58a6ff;
    text-decoration: none;
    font-weight: 500;
  }

  a:hover {
    text-decoration: underline;
  }

  .url {
    display: block;
    font-size: 0.75rem;
    color: #6b737e;
    margin-top: 0.25rem;
  }

  .delete {
    background: transparent;
    color: #f85149;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
  }

  .delete:hover {
    background: rgba(248, 81, 73, 0.15);
  }

  .tags {
    display: flex;
    gap: 0.375rem;
    margin-top: 0.5rem;
  }

  .tag {
    background: #1f6feb33;
    color: #58a6ff;
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    font-size: 0.7rem;
  }

  .empty {
    color: #6b737e;
    text-align: center;
    margin-top: 2rem;
  }
</style>
