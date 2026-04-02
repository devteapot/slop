import { createSignal, Show, For } from "solid-js";
import { useSlop } from "@slop-ai/solid";
import { slop } from "./slop";
import * as store from "./store";
import type { Board, Card } from "./types";
import BoardSwitcher from "./components/BoardSwitcher";
import Column from "./components/Column";
import SearchBar from "./components/SearchBar";
import CreateCard from "./components/CreateCard";
import CardDetail from "./components/CardDetail";

export default function App() {
  const [boards, setBoards] = createSignal<Board[]>(store.getBoards());
  const [activeBoardId, setActiveBoardId] = createSignal(boards()[0]?.id || "");
  const [cards, setCards] = createSignal<Card[]>(store.getCardsForBoard(activeBoardId()));
  const [searchQuery, setSearchQuery] = createSignal("");
  const [showCreate, setShowCreate] = createSignal(false);
  const [detailCardId, setDetailCardId] = createSignal<string | null>(null);
  const [version, setVersion] = createSignal(0);

  const activeBoard = () => boards().find((b) => b.id === activeBoardId());

  const refresh = () => {
    setBoards(store.getBoards());
    setCards(store.getCardsForBoard(activeBoardId()));
    setVersion((v) => v + 1);
  };

  const navigateToBoard = (boardId: string) => {
    setActiveBoardId(boardId);
    setCards(store.getCardsForBoard(boardId));
    setSearchQuery("");
    setDetailCardId(null);
  };

  const handleCreateBoard = (name: string) => {
    const board = store.createBoard(name);
    refresh();
    navigateToBoard(board.id);
  };

  const handleCreateCard = (
    title: string,
    column?: string,
    priority?: Card["priority"],
    due?: string,
    description?: string,
    tags?: string[],
  ) => {
    store.createCard(activeBoardId(), title, column, priority, due, description, tags);
    refresh();
  };

  const handleMoveCard = (cardId: string, column: string) => {
    store.moveCard(cardId, column);
    refresh();
  };

  const handleEditCard = (cardId: string, updates: Partial<Pick<Card, "title" | "priority" | "due" | "tags">>) => {
    store.editCard(cardId, updates);
    refresh();
  };

  const handleDeleteCard = (cardId: string) => {
    store.deleteCard(cardId);
    if (detailCardId() === cardId) setDetailCardId(null);
    refresh();
  };

  const handleSetDescription = (cardId: string, content: string) => {
    store.setCardDescription(cardId, content);
    refresh();
  };

  const handleRenameBoard = (name: string) => {
    store.renameBoard(activeBoardId(), name);
    refresh();
  };

  const handleDeleteBoard = () => {
    store.deleteBoard(activeBoardId());
    const remaining = store.getBoards();
    if (remaining.length > 0) {
      navigateToBoard(remaining[0].id);
    }
    refresh();
  };

  const handleReorderCard = (column: string, cardId: string, position: number) => {
    store.reorderCard(activeBoardId(), column, cardId, position);
    refresh();
  };

  const buildBoardSummary = (board: Board): string => {
    const boardCards = store.getCardsForBoard(board.id);
    const dueThisWeek = boardCards.filter((c) => {
      if (!c.due || c.column === "done") return false;
      const days = Math.round(
        (new Date(c.due).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      return days >= 0 && days <= 7;
    }).length;
    return `${board.columns.length} columns, ${boardCards.length} cards${dueThisWeek > 0 ? `, ${dueThisWeek} due this week` : ""}`;
  };

  // SLOP: root node
  useSlop(slop, "/", () => ({
    type: "root",
    props: { board_count: boards().length, active_board: activeBoardId() },
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
      boards().map((board) => {
        if (board.id === activeBoardId()) return [board.id, { type: "view" }];
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

  // SLOP: active board node (dynamic path via adapter)
  useSlop(slop, () => activeBoard()?.id ?? "__none__", () => {
    const ab = activeBoard();
    if (!ab) return { type: "view" as const };
    return {
      type: "view" as const,
      props: {
        name: ab.name,
        card_count: cards().length,
        column_count: ab.columns.length,
      },
      meta: { focus: true },
      actions: {
        create_card: {
          params: {
            title: "string",
            column: { type: "string", description: `Target column. One of: ${ab.columns.join(", ")}` },
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
            const results = store.searchCards(activeBoardId(), query as string);
            return results.map((c) => ({ id: c.id, title: c.title, column: c.column, priority: c.priority }));
          },
        },
      },
    };
  });

  const filteredCards = () =>
    searchQuery()
      ? store.searchCards(activeBoardId(), searchQuery())
      : cards();

  const detailCard = () => {
    const id = detailCardId();
    return id ? cards().find((c) => c.id === id) ?? null : null;
  };

  return (
    <div class="app">
      <header class="app-header">
        <div class="app-header-left">
          <h1 class="app-title">Kanban Board</h1>
          <BoardSwitcher
            boards={boards()}
            activeBoardId={activeBoardId()}
            onNavigate={navigateToBoard}
            onCreateBoard={handleCreateBoard}
          />
        </div>
        <div class="app-header-right">
          <SearchBar query={searchQuery()} onQueryChange={setSearchQuery} />
          <button class="btn-primary" onClick={() => setShowCreate(true)}>
            + New Card
          </button>
        </div>
      </header>

      <Show when={activeBoard()}>
        {(ab) => (
          <div class="board">
            <For each={ab().columns}>
              {(col, i) => (
                <Column
                  boardId={activeBoardId()}
                  columnId={col}
                  position={i()}
                  cards={filteredCards().filter((c) => c.column === col)}
                  allColumns={ab().columns}
                  onMoveCard={handleMoveCard}
                  onEditCard={handleEditCard}
                  onDeleteCard={handleDeleteCard}
                  onReorderCard={handleReorderCard}
                  onSetDescription={handleSetDescription}
                  onOpenDetail={setDetailCardId}
                />
              )}
            </For>
          </div>
        )}
      </Show>

      <Show when={showCreate() && activeBoard()}>
        {(ab) => (
          <CreateCard
            columns={ab().columns}
            onSubmit={(title, column, priority, due, description, tags) => {
              handleCreateCard(title, column, priority, due, description, tags);
              setShowCreate(false);
            }}
            onClose={() => setShowCreate(false)}
          />
        )}
      </Show>

      <Show when={detailCard()}>
        {(card) => (
          <CardDetail
            card={card()}
            columns={activeBoard()?.columns || []}
            onEdit={(updates) => handleEditCard(card().id, updates)}
            onMove={(column) => handleMoveCard(card().id, column)}
            onDelete={() => handleDeleteCard(card().id)}
            onSetDescription={(content) => handleSetDescription(card().id, content)}
            onClose={() => setDetailCardId(null)}
          />
        )}
      </Show>
    </div>
  );
}
