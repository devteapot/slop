import type { SlopNode } from "@slop/types";
import type { Board, Column, Card } from "./state";

export function buildTree(board: Board): SlopNode {
  const allCards = board.columns.flatMap((c) => c.cards);
  const columnIds = board.columns.map((c) => c.id);

  return {
    id: "root",
    type: "root",
    properties: { label: "Kanban Board" },
    affordances: [
      {
        action: "add_card",
        label: "Add Card",
        description: "Add a new card to a column",
        params: {
          type: "object",
          properties: {
            column: {
              type: "string",
              enum: columnIds,
              description: "Target column ID",
            },
            title: { type: "string", description: "Card title" },
            description: { type: "string", description: "Card description" },
            color: { type: "string", description: "Card color hex code" },
          },
          required: ["column", "title"],
        },
      },
    ],
    children: [
      ...board.columns.map((col) => columnToNode(col, columnIds)),
      {
        id: "stats",
        type: "status",
        properties: Object.fromEntries(
          board.columns.map((c) => [c.id, c.cards.length])
        ),
        meta: {
          summary: board.columns
            .map((c) => `${c.cards.length} ${c.label.toLowerCase()}`)
            .join(", "),
        },
      },
    ],
  };
}

function columnToNode(column: Column, allColumnIds: string[]): SlopNode {
  return {
    id: column.id,
    type: "collection",
    properties: {
      label: column.label,
      count: column.cards.length,
    },
    affordances: column.cards.length > 0
      ? [{ action: "clear_column", label: `Clear ${column.label}`, dangerous: true }]
      : [],
    children: column.cards.map((card) =>
      cardToNode(card, column.id, allColumnIds)
    ),
  };
}

function cardToNode(card: Card, currentColumnId: string, allColumnIds: string[]): SlopNode {
  const otherColumns = allColumnIds.filter((id) => id !== currentColumnId);

  return {
    id: card.id,
    type: "item",
    properties: {
      title: card.title,
      description: card.description,
      color: card.color,
      created: card.created,
      column: currentColumnId,
    },
    affordances: [
      {
        action: "move",
        label: "Move Card",
        description: `Move this card to another column (currently in ${currentColumnId})`,
        params: {
          type: "object",
          properties: {
            to_column: {
              type: "string",
              enum: otherColumns,
              description: "Target column ID",
            },
          },
          required: ["to_column"],
        },
      },
      {
        action: "edit",
        label: "Edit Card",
        params: {
          type: "object",
          properties: {
            title: { type: "string", description: "New title" },
            description: { type: "string", description: "New description" },
            color: { type: "string", description: "New color hex" },
          },
        },
      },
      {
        action: "delete",
        label: "Delete Card",
        dangerous: true,
      },
    ],
    meta: {
      salience: currentColumnId === "in-progress" ? 0.8 : currentColumnId === "backlog" ? 0.5 : 0.2,
    },
  };
}
