import type { Board, Card, KanbanData } from "./types";
import seedData from "../../../seed.json";

const STORAGE_KEY = "kanban-data";

function load(): KanbanData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn("[slop] invalid kanban data in localStorage, resetting to seed:", error);
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  const data = seedData as KanbanData;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}

function save(data: KanbanData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

let data = load();

export function getBoards(): Board[] {
  return data.boards;
}

export function getBoard(id: string): Board | undefined {
  return data.boards.find((b) => b.id === id);
}

export function getCardsForBoard(boardId: string): Card[] {
  return data.cards.filter((c) => c.board_id === boardId);
}

export function getCardsForColumn(boardId: string, column: string): Card[] {
  return data.cards
    .filter((c) => c.board_id === boardId && c.column === column)
    .sort((a, b) => a.position - b.position);
}

export function createBoard(name: string): Board {
  const id = `board-${Date.now()}`;
  const board: Board = { id, name, columns: ["todo", "in-progress", "done"] };
  data = { ...data, boards: [...data.boards, board] };
  save(data);
  return board;
}

export function renameBoard(boardId: string, name: string) {
  data = {
    ...data,
    boards: data.boards.map((b) => (b.id === boardId ? { ...b, name } : b)),
  };
  save(data);
}

export function deleteBoard(boardId: string) {
  data = {
    boards: data.boards.filter((b) => b.id !== boardId),
    cards: data.cards.filter((c) => c.board_id !== boardId),
  };
  save(data);
}

export function createCard(
  boardId: string,
  title: string,
  column?: string,
  priority?: Card["priority"],
  due?: string,
  description?: string,
  tags?: string[],
): Card {
  const board = getBoard(boardId);
  const targetColumn = column || board?.columns[0] || "todo";
  const existing = getCardsForColumn(boardId, targetColumn);
  const card: Card = {
    id: `card-${Date.now()}`,
    board_id: boardId,
    column: targetColumn,
    title,
    priority: priority || "medium",
    tags: tags || [],
    due: due || null,
    description: description || "",
    position: existing.length,
    created: new Date().toISOString(),
  };
  data = { ...data, cards: [...data.cards, card] };
  save(data);
  return card;
}

export function editCard(
  cardId: string,
  updates: Partial<Pick<Card, "title" | "priority" | "due" | "tags">>,
) {
  data = {
    ...data,
    cards: data.cards.map((c) => (c.id === cardId ? { ...c, ...updates } : c)),
  };
  save(data);
}

export function moveCard(cardId: string, targetColumn: string) {
  const card = data.cards.find((c) => c.id === cardId);
  if (!card) return;
  const targetCards = getCardsForColumn(card.board_id, targetColumn);
  data = {
    ...data,
    cards: data.cards.map((c) =>
      c.id === cardId ? { ...c, column: targetColumn, position: targetCards.length } : c,
    ),
  };
  save(data);
}

export function deleteCard(cardId: string) {
  data = { ...data, cards: data.cards.filter((c) => c.id !== cardId) };
  save(data);
}

export function setCardDescription(cardId: string, content: string) {
  data = {
    ...data,
    cards: data.cards.map((c) => (c.id === cardId ? { ...c, description: content } : c)),
  };
  save(data);
}

export function reorderCard(boardId: string, column: string, cardId: string, position: number) {
  const columnCards = getCardsForColumn(boardId, column).filter((c) => c.id !== cardId);
  columnCards.splice(position, 0, data.cards.find((c) => c.id === cardId)!);
  const updatedIds = new Set(columnCards.map((c) => c.id));
  data = {
    ...data,
    cards: data.cards.map((c) => {
      if (updatedIds.has(c.id)) {
        return { ...c, position: columnCards.findIndex((cc) => cc.id === c.id) };
      }
      return c;
    }),
  };
  save(data);
}

export function searchCards(boardId: string, query: string): Card[] {
  const q = query.toLowerCase();
  return getCardsForBoard(boardId).filter(
    (c) =>
      c.title.toLowerCase().includes(q) ||
      c.tags.some((t) => t.toLowerCase().includes(q)) ||
      c.description.toLowerCase().includes(q),
  );
}

export function resetToSeed() {
  data = seedData as KanbanData;
  save(data);
}
