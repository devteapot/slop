export interface Board {
  id: string;
  name: string;
  columns: string[];
}

export interface Card {
  id: string;
  board_id: string;
  column: string;
  title: string;
  priority: "low" | "medium" | "high" | "critical";
  tags: string[];
  due: string | null;
  description: string;
  position: number;
  created: string;
}

export interface KanbanData {
  boards: Board[];
  cards: Card[];
}
