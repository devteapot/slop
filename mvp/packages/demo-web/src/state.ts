export interface Card {
  id: string;
  title: string;
  description: string;
  created: string;
  color: string;
}

export interface Column {
  id: string;
  label: string;
  cards: Card[];
}

export interface Board {
  columns: Column[];
}

let nextId = 6;

export function createBoard(): Board {
  return {
    columns: [
      {
        id: "backlog",
        label: "Backlog",
        cards: [
          {
            id: "card-1",
            title: "Design the API",
            description: "Define endpoints and data models",
            created: new Date().toISOString(),
            color: "#4a9eff",
          },
          {
            id: "card-2",
            title: "Write tests",
            description: "Unit and integration tests",
            created: new Date().toISOString(),
            color: "#a855f7",
          },
        ],
      },
      {
        id: "in-progress",
        label: "In Progress",
        cards: [
          {
            id: "card-3",
            title: "Build the MVP",
            description: "Core functionality first",
            created: new Date().toISOString(),
            color: "#f59e0b",
          },
        ],
      },
      {
        id: "done",
        label: "Done",
        cards: [
          {
            id: "card-4",
            title: "Read the SLOP spec",
            description: "All 7 documents",
            created: new Date().toISOString(),
            color: "#22c55e",
          },
          {
            id: "card-5",
            title: "Set up the repo",
            description: "Monorepo with Bun workspaces",
            created: new Date().toISOString(),
            color: "#22c55e",
          },
        ],
      },
    ],
  };
}

// --- Mutation functions ---

function findCard(board: Board, cardId: string): { column: Column; cardIndex: number } | null {
  for (const col of board.columns) {
    const idx = col.cards.findIndex((c) => c.id === cardId);
    if (idx !== -1) return { column: col, cardIndex: idx };
  }
  return null;
}

export function addCard(
  board: Board,
  columnId: string,
  title: string,
  description?: string,
  color?: string
): string {
  const col = board.columns.find((c) => c.id === columnId);
  if (!col) throw { code: "not_found", message: `Column ${columnId} not found` };

  const card: Card = {
    id: `card-${nextId++}`,
    title,
    description: description ?? "",
    created: new Date().toISOString(),
    color: color ?? "#4a9eff",
  };
  col.cards.push(card);
  return `Added "${title}" to ${col.label}`;
}

export function moveCard(
  board: Board,
  cardId: string,
  toColumnId: string
): string {
  const found = findCard(board, cardId);
  if (!found) throw { code: "not_found", message: `Card ${cardId} not found` };

  const target = board.columns.find((c) => c.id === toColumnId);
  if (!target) throw { code: "not_found", message: `Column ${toColumnId} not found` };

  const [card] = found.column.cards.splice(found.cardIndex, 1);
  target.cards.push(card);
  return `Moved "${card.title}" to ${target.label}`;
}

export function editCard(
  board: Board,
  cardId: string,
  updates: { title?: string; description?: string; color?: string }
): string {
  const found = findCard(board, cardId);
  if (!found) throw { code: "not_found", message: `Card ${cardId} not found` };

  const card = found.column.cards[found.cardIndex];
  if (updates.title !== undefined) card.title = updates.title;
  if (updates.description !== undefined) card.description = updates.description;
  if (updates.color !== undefined) card.color = updates.color;
  return `Edited "${card.title}"`;
}

export function deleteCard(board: Board, cardId: string): string {
  const found = findCard(board, cardId);
  if (!found) throw { code: "not_found", message: `Card ${cardId} not found` };

  const [card] = found.column.cards.splice(found.cardIndex, 1);
  return `Deleted "${card.title}"`;
}

export function clearColumn(board: Board, columnId: string): string {
  const col = board.columns.find((c) => c.id === columnId);
  if (!col) throw { code: "not_found", message: `Column ${columnId} not found` };

  const count = col.cards.length;
  col.cards = [];
  return `Cleared ${count} card${count === 1 ? "" : "s"} from ${col.label}`;
}
