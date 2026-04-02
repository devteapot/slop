<script lang="ts">
  import { slop } from "./slop";
  import { useSlop } from "@slop-ai/svelte";
  import * as store from "./store";
  import type { Board, Card } from "./types";
  import BoardSwitcher from "./components/BoardSwitcher.svelte";
  import Column from "./components/Column.svelte";
  import SearchBar from "./components/SearchBar.svelte";
  import CreateCard from "./components/CreateCard.svelte";
  import CardDetail from "./components/CardDetail.svelte";

  let boards = $state<Board[]>(store.getBoards());
  let activeBoardId = $state(boards[0]?.id || "");
  let cards = $state<Card[]>(store.getCardsForBoard(activeBoardId));
  let searchQuery = $state("");
  let showCreate = $state(false);
  let detailCardId = $state<string | null>(null);
  let version = $state(0);

  let activeBoard = $derived(boards.find((b) => b.id === activeBoardId));

  function refresh() {
    boards = store.getBoards();
    cards = store.getCardsForBoard(activeBoardId);
    version += 1;
  }

  function navigateToBoard(boardId: string) {
    activeBoardId = boardId;
    cards = store.getCardsForBoard(boardId);
    searchQuery = "";
    detailCardId = null;
  }

  function handleCreateBoard(name: string) {
    const board = store.createBoard(name);
    refresh();
    navigateToBoard(board.id);
  }

  function handleCreateCard(
    title: string,
    column?: string,
    priority?: Card["priority"],
    due?: string,
    description?: string,
    tags?: string[],
  ) {
    store.createCard(activeBoardId, title, column, priority, due, description, tags);
    refresh();
  }

  function handleMoveCard(cardId: string, column: string) {
    store.moveCard(cardId, column);
    refresh();
  }

  function handleEditCard(cardId: string, updates: Partial<Pick<Card, "title" | "priority" | "due" | "tags">>) {
    store.editCard(cardId, updates);
    refresh();
  }

  function handleDeleteCard(cardId: string) {
    store.deleteCard(cardId);
    if (detailCardId === cardId) detailCardId = null;
    refresh();
  }

  function handleSetDescription(cardId: string, content: string) {
    store.setCardDescription(cardId, content);
    refresh();
  }

  function handleRenameBoard(name: string) {
    store.renameBoard(activeBoardId, name);
    refresh();
  }

  function handleDeleteBoard() {
    store.deleteBoard(activeBoardId);
    const remaining = store.getBoards();
    if (remaining.length > 0) {
      navigateToBoard(remaining[0].id);
    }
    refresh();
  }

  function handleReorderCard(column: string, cardId: string, position: number) {
    store.reorderCard(activeBoardId, column, cardId, position);
    refresh();
  }

  function buildBoardSummary(board: Board): string {
    const boardCards = store.getCardsForBoard(board.id);
    const dueThisWeek = boardCards.filter((c) => {
      if (!c.due || c.column === "done") return false;
      const days = Math.round(
        (new Date(c.due).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      return days >= 0 && days <= 7;
    }).length;
    return `${board.columns.length} columns, ${boardCards.length} cards${dueThisWeek > 0 ? `, ${dueThisWeek} due this week` : ""}`;
  }

  // SLOP: root node
  useSlop(slop, "/", () => ({
    type: "root",
    props: { board_count: boards.length, active_board: activeBoardId },
    actions: {
      create_board: {
        params: { name: "string" },
        handler: ({ name }: Record<string, unknown>) => handleCreateBoard(name as string),
      },
      navigate: {
        params: { board_id: "string" },
        idempotent: true,
        handler: ({ board_id }: Record<string, unknown>) => navigateToBoard(board_id as string),
      },
    },
    children: Object.fromEntries(
      boards.map((board) => {
        if (board.id === activeBoardId) return [board.id, { type: "view" }];
        return [
          board.id,
          {
            type: "view",
            props: { name: board.name },
            meta: { summary: buildBoardSummary(board) },
          },
        ];
      }),
    ),
  }));

  // SLOP: active board node (dynamic path — switches when navigating boards)
  useSlop(slop, () => activeBoard?.id ?? "__none__", () => {
    if (!activeBoard) return { type: "view" };
    return {
      type: "view",
      props: {
        name: activeBoard.name,
        card_count: cards.length,
        column_count: activeBoard.columns.length,
      },
      meta: { focus: true },
      actions: {
        create_card: {
          params: {
            title: "string",
            column: { type: "string", description: `Target column. One of: ${activeBoard.columns.join(", ")}` },
            priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
            due: { type: "string", description: "ISO date string" },
            description: { type: "string", description: "Markdown description" },
            tags: { type: "string", description: "Comma-separated tags" },
          },
          handler: ({ title, column, priority, due, description, tags }: Record<string, unknown>) => {
            const tagList = typeof tags === "string" ? tags.split(",").map((t: string) => t.trim()).filter(Boolean) : undefined;
            handleCreateCard(
              title as string,
              column as string | undefined,
              priority as Card["priority"] | undefined,
              due as string | undefined,
              description as string | undefined,
              tagList,
            );
          },
        },
        rename: {
          params: { name: "string" },
          idempotent: true,
          handler: ({ name }: Record<string, unknown>) => handleRenameBoard(name as string),
        },
        delete: {
          dangerous: true,
          handler: () => handleDeleteBoard(),
        },
        search: {
          params: { query: "string" },
          handler: ({ query }: Record<string, unknown>) => {
            const results = store.searchCards(activeBoardId, query as string);
            return results.map((c) => ({ id: c.id, title: c.title, column: c.column, priority: c.priority }));
          },
        },
      },
    };
  });

  let filteredCards = $derived(
    searchQuery ? store.searchCards(activeBoardId, searchQuery) : cards,
  );

  let detailCard = $derived(detailCardId ? cards.find((c) => c.id === detailCardId) : null);
</script>

<div class="app">
  <header class="app-header">
    <div class="app-header-left">
      <h1 class="app-title">Kanban Board</h1>
      <BoardSwitcher
        {boards}
        {activeBoardId}
        onNavigate={navigateToBoard}
        onCreateBoard={handleCreateBoard}
      />
    </div>
    <div class="app-header-right">
      <SearchBar query={searchQuery} onQueryChange={(q) => (searchQuery = q)} />
      <button class="btn-primary" onclick={() => (showCreate = true)}>
        + New Card
      </button>
    </div>
  </header>

  {#if activeBoard}
    {#key `${activeBoardId}-${version}`}
      <div class="board">
        {#each activeBoard.columns as col, i (col)}
          <Column
            boardId={activeBoardId}
            columnId={col}
            position={i}
            cards={filteredCards.filter((c) => c.column === col)}
            allColumns={activeBoard.columns}
            onMoveCard={handleMoveCard}
            onEditCard={handleEditCard}
            onDeleteCard={handleDeleteCard}
            onReorderCard={handleReorderCard}
            onSetDescription={handleSetDescription}
            onOpenDetail={(id) => (detailCardId = id)}
          />
        {/each}
      </div>
    {/key}
  {/if}

  {#if showCreate && activeBoard}
    <CreateCard
      columns={activeBoard.columns}
      onSubmit={(title, column, priority, due, description, tags) => {
        handleCreateCard(title, column, priority, due, description, tags);
        showCreate = false;
      }}
      onClose={() => (showCreate = false)}
    />
  {/if}

  {#if detailCard}
    <CardDetail
      card={detailCard}
      columns={activeBoard?.columns || []}
      onEdit={(updates) => handleEditCard(detailCard.id, updates)}
      onMove={(column) => handleMoveCard(detailCard.id, column)}
      onDelete={() => handleDeleteCard(detailCard.id)}
      onSetDescription={(content) => handleSetDescription(detailCard.id, content)}
      onClose={() => (detailCardId = null)}
    />
  {/if}
</div>
