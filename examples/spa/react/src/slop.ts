import { createSlop } from "@slop-ai/client";

export const slop = createSlop({
  id: "kanban-board",
  name: "Kanban Board",
  websocketUrl: true,
});
