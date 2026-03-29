<script lang="ts">
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { onMount, onDestroy } from "svelte";

  let { data } = $props();

  let ws: WebSocket | null = $state(null);
  let connected = $state(false);

  onMount(() => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${proto}//${location.host}/slop`);

    socket.addEventListener("open", () => {
      connected = true;
      socket.send(
        JSON.stringify({ type: "subscribe", id: "sub-1", path: "/", depth: -1 })
      );
    });

    socket.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "snapshot") {
        // Re-fetch server data when SLOP notifies of changes
        invalidateAll();
      }
    });

    socket.addEventListener("close", () => {
      connected = false;
    });

    ws = socket;
  });

  onDestroy(() => {
    ws?.close();
  });

  function invokeAction(path: string, action: string, params?: Record<string, unknown>) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "invoke",
          id: `inv-${Date.now()}`,
          path,
          action,
          params,
        })
      );
    }
  }

  let newTitle = $state("");
  let newUrl = $state("");
</script>

<main>
  <header>
    <h1>Links</h1>
    <p class="subtitle">
      {data.links.length} links &middot;
      {data.links.reduce((s, l) => s + l.clicks, 0)} total clicks
      <span class="status" class:online={connected}>
        {connected ? "SLOP connected" : "SLOP disconnected"}
      </span>
    </p>
  </header>

  <section class="add-form">
    <h2>Add Link</h2>
    <form
      method="POST"
      action="?/add"
      use:enhance={() => {
        return async ({ update }) => {
          await update();
          newTitle = "";
          newUrl = "";
        };
      }}
    >
      <div class="form-row">
        <input
          type="text"
          name="title"
          placeholder="Title"
          required
          bind:value={newTitle}
        />
        <input
          type="url"
          name="url"
          placeholder="https://example.com"
          required
          bind:value={newUrl}
        />
        <button type="submit" class="btn btn-add">Add</button>
      </div>
    </form>
  </section>

  <section class="links-list">
    {#each data.links as link (link.id)}
      <div class="link-card">
        <div class="link-info">
          <a href={link.url} class="link-title" target="_blank" rel="noopener">
            {link.title}
          </a>
          <span class="link-url">{link.url}</span>
          <div class="link-meta">
            <span class="clicks">{link.clicks} click{link.clicks !== 1 ? "s" : ""}</span>
            <span class="sep">&middot;</span>
            <span class="created">{link.created}</span>
          </div>
        </div>
        <div class="link-actions">
          <form method="POST" action="?/visit" use:enhance>
            <input type="hidden" name="id" value={link.id} />
            <button type="submit" class="btn btn-visit" title="Track click">
              +1
            </button>
          </form>
          <form method="POST" action="?/delete" use:enhance>
            <input type="hidden" name="id" value={link.id} />
            <button type="submit" class="btn btn-delete" title="Delete link">
              &times;
            </button>
          </form>
        </div>
      </div>
    {:else}
      <p class="empty">No links yet. Add one above.</p>
    {/each}
  </section>

  <footer>
    <p>
      Powered by <strong>SLOP</strong> &mdash; State &amp; Layout Observation Protocol
    </p>
  </footer>
</main>

<style>
  main {
    max-width: 720px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  header {
    margin-bottom: 2rem;
  }

  h1 {
    font-size: 2rem;
    font-weight: 700;
    color: #e1e4e8;
  }

  .subtitle {
    color: #8b949e;
    margin-top: 0.25rem;
    font-size: 0.9rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border-radius: 9999px;
    background: rgba(218, 54, 51, 0.15);
    color: #da3633;
  }

  .status::before {
    content: "";
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #da3633;
  }

  .status.online {
    background: rgba(35, 134, 54, 0.15);
    color: #3fb950;
  }

  .status.online::before {
    background: #3fb950;
  }

  .add-form {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .add-form h2 {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #8b949e;
    margin-bottom: 0.75rem;
  }

  .form-row {
    display: flex;
    gap: 0.5rem;
  }

  input[type="text"],
  input[type="url"] {
    flex: 1;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    color: #e1e4e8;
    font-size: 0.9rem;
    outline: none;
    transition: border-color 0.15s;
  }

  input:focus {
    border-color: #58a6ff;
  }

  input::placeholder {
    color: #484f58;
  }

  .btn {
    border: none;
    border-radius: 6px;
    padding: 0.5rem 1rem;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .btn:hover {
    opacity: 0.85;
  }

  .btn-add {
    background: #238636;
    color: #fff;
  }

  .btn-visit {
    background: #1f6feb;
    color: #fff;
    padding: 0.35rem 0.65rem;
    font-size: 0.8rem;
  }

  .btn-delete {
    background: #da3633;
    color: #fff;
    padding: 0.35rem 0.65rem;
    font-size: 1rem;
    line-height: 1;
  }

  .links-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .link-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    transition: border-color 0.15s;
  }

  .link-card:hover {
    border-color: #484f58;
  }

  .link-info {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }

  .link-title {
    color: #58a6ff;
    text-decoration: none;
    font-weight: 600;
    font-size: 1rem;
  }

  .link-title:hover {
    text-decoration: underline;
  }

  .link-url {
    color: #484f58;
    font-size: 0.8rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .link-meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
    color: #8b949e;
    margin-top: 0.15rem;
  }

  .sep {
    color: #30363d;
  }

  .link-actions {
    display: flex;
    gap: 0.35rem;
    flex-shrink: 0;
    margin-left: 1rem;
  }

  .empty {
    text-align: center;
    color: #484f58;
    padding: 3rem 1rem;
  }

  footer {
    margin-top: 3rem;
    text-align: center;
    color: #484f58;
    font-size: 0.8rem;
  }

  footer strong {
    color: #8b949e;
  }

  @media (max-width: 540px) {
    .form-row {
      flex-direction: column;
    }

    .link-card {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
    }

    .link-actions {
      margin-left: 0;
    }
  }
</style>
