import { useState, useCallback } from "react";
import { action, useSlop } from "@slop-ai/react";
import { slop } from "./slop";
import * as store from "./store";
import type { Board, Card } from "./types";
import BoardSwitcher from "./components/BoardSwitcher";
import Column from "./components/Column";
import SearchBar from "./components/SearchBar";
import CreateCard from "./components/CreateCard";
import CardDetail from "./components/CardDetail";

export default function App() {
  const [boards, setBoards] = useState<Board[]>(store.getBoards());
  const [activeBoardId, setActiveBoardId] = useState(boards[0]?.id || "");
  const [cards, setCards] = useState<Card[]>(store.getCardsForBoard(activeBoardId));
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [detailCardId, setDetailCardId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const activeBoard = boards.find((b) => b.id === activeBoardId);

  const refresh = useCallback(() => {
    setBoards(store.getBoards());
    setCards(store.getCardsForBoard(activeBoardId));
    setVersion((v) => v + 1);
  }, [activeBoardId]);

  const navigateToBoard = useCallback(
    (boardId: string) => {
      setActiveBoardId(boardId);
      setCards(store.getCardsForBoard(boardId));
      setSearchQuery("");
      setDetailCardId(null);
    },
    [],
  );

  const handleCreateBoard = useCallback(
    (name: string) => {
      const board = store.createBoard(name);
      refresh();
      navigateToBoard(board.id);
    },
    [refresh, navigateToBoard],
  );

  const handleCreateCard = useCallback(
    (title: string, column?: string, priority?: Card["priority"], due?: string, description?: string, tags?: string[]) => {
      store.createCard(activeBoardId, title, column, priority, due, description, tags);
      refresh();
    },
    [activeBoardId, refresh],
  );

  const handleMoveCard = useCallback(
    (cardId: string, column: string) => {
      store.moveCard(cardId, column);
      refresh();
    },
    [refresh],
  );

  const handleEditCard = useCallback(
    (cardId: string, updates: Partial<Pick<Card, "title" | "priority" | "due" | "tags">>) => {
      store.editCard(cardId, updates);
      refresh();
    },
    [refresh],
  );

  const handleDeleteCard = useCallback(
    (cardId: string) => {
      store.deleteCard(cardId);
      if (detailCardId === cardId) setDetailCardId(null);
      refresh();
    },
    [refresh, detailCardId],
  );

  const handleSetDescription = useCallback(
    (cardId: string, content: string) => {
      store.setCardDescription(cardId, content);
      refresh();
    },
    [refresh],
  );

  const handleRenameBoard = useCallback(
    (name: string) => {
      store.renameBoard(activeBoardId, name);
      refresh();
    },
    [activeBoardId, refresh],
  );

  const handleDeleteBoard = useCallback(() => {
    store.deleteBoard(activeBoardId);
    const remaining = store.getBoards();
    if (remaining.length > 0) {
      navigateToBoard(remaining[0].id);
    }
    refresh();
  }, [activeBoardId, refresh, navigateToBoard]);

  const handleReorderCard = useCallback(
    (column: string, cardId: string, position: number) => {
      store.reorderCard(activeBoardId, column, cardId, position);
      refresh();
    },
    [activeBoardId, refresh],
  );

  // Build the board summary for inactive boards
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
    props: { board_count: boards.length, active_board: activeBoardId },
    actions: {
      create_board: action({ name: "string" }, ({ name }) => handleCreateBoard(name)),
      navigate: action(
        { board_id: "string" },
        ({ board_id }) => navigateToBoard(board_id),
        { idempotent: true },
      ),
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

  // SLOP: active board node
  useSlop(slop, () => activeBoard?.id ?? "__none__", () => {
    if (!activeBoard) return { type: "view" as const };
    return {
      type: "view" as const,
      props: {
        name: activeBoard.name,
        card_count: cards.length,
        column_count: activeBoard.columns.length,
      },
      meta: { focus: true },
      actions: {
        create_card: action(
          {
            title: "string",
            column: { type: "string", description: `Target column. One of: ${activeBoard.columns.join(", ")}` },
            priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
            due: { type: "string", description: "ISO date string" },
            description: { type: "string", description: "Markdown description" },
            tags: { type: "string", description: "Comma-separated tags" },
          },
          ({ title, column, priority, due, description, tags }) => {
            const tagList = tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
            handleCreateCard(
              title,
              column || undefined,
              priority as Card["priority"] | undefined,
              due || undefined,
              description || undefined,
              tagList,
            );
          },
        ),
        rename: action(
          { name: "string" },
          ({ name }) => handleRenameBoard(name),
          { idempotent: true },
        ),
        delete: action(() => handleDeleteBoard(), { dangerous: true }),
        search: action({ query: "string" }, ({ query }) => {
          const results = store.searchCards(activeBoardId, query);
          return results.map((c) => ({
            id: c.id,
            title: c.title,
            column: c.column,
            priority: c.priority,
          }));
        }),
      },
    };
  });

  const filteredCards = searchQuery
    ? store.searchCards(activeBoardId, searchQuery)
    : cards;

  const detailCard = detailCardId ? cards.find((c) => c.id === detailCardId) : null;

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-left">
          <h1 className="app-title">Kanban Board</h1>
          <BoardSwitcher
            boards={boards}
            activeBoardId={activeBoardId}
            onNavigate={navigateToBoard}
            onCreateBoard={handleCreateBoard}
          />
        </div>
        <div className="app-header-right">
          <SearchBar query={searchQuery} onQueryChange={setSearchQuery} />
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + New Card
          </button>
        </div>
      </header>

      {activeBoard && (
        <div className="board" key={`${activeBoardId}-${version}`}>
          {activeBoard.columns.map((col, i) => (
            <Column
              key={col}
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
              onOpenDetail={setDetailCardId}
            />
          ))}
        </div>
      )}

      {showCreate && activeBoard && (
        <CreateCard
          columns={activeBoard.columns}
          onSubmit={(title, column, priority, due, description, tags) => {
            handleCreateCard(title, column, priority, due, description, tags);
            setShowCreate(false);
          }}
          onClose={() => setShowCreate(false)}
        />
      )}

      {detailCard && (
        <CardDetail
          card={detailCard}
          columns={activeBoard?.columns || []}
          onEdit={(updates) => handleEditCard(detailCard.id, updates)}
          onMove={(column) => handleMoveCard(detailCard.id, column)}
          onDelete={() => handleDeleteCard(detailCard.id)}
          onSetDescription={(content) => handleSetDescription(detailCard.id, content)}
          onClose={() => setDetailCardId(null)}
        />
      )}
    </div>
  );
}
