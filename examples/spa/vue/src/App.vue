<script setup lang="ts">
import { ref, computed } from "vue";
import { useSlop } from "@slop-ai/vue";
import { slop } from "./slop";
import * as store from "./store";
import type { Board, Card } from "./types";
import BoardSwitcher from "./components/BoardSwitcher.vue";
import Column from "./components/Column.vue";
import SearchBar from "./components/SearchBar.vue";
import CreateCard from "./components/CreateCard.vue";
import CardDetail from "./components/CardDetail.vue";

const boards = ref<Board[]>(store.getBoards());
const activeBoardId = ref(boards.value[0]?.id || "");
const cards = ref<Card[]>(store.getCardsForBoard(activeBoardId.value));
const searchQuery = ref("");
const showCreate = ref(false);
const detailCardId = ref<string | null>(null);
const version = ref(0);

const activeBoard = computed(() => boards.value.find((b) => b.id === activeBoardId.value));

function refresh() {
  boards.value = store.getBoards();
  cards.value = store.getCardsForBoard(activeBoardId.value);
  version.value++;
}

function navigateToBoard(boardId: string) {
  activeBoardId.value = boardId;
  cards.value = store.getCardsForBoard(boardId);
  searchQuery.value = "";
  detailCardId.value = null;
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
  store.createCard(activeBoardId.value, title, column, priority, due, description, tags);
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
  if (detailCardId.value === cardId) detailCardId.value = null;
  refresh();
}

function handleSetDescription(cardId: string, content: string) {
  store.setCardDescription(cardId, content);
  refresh();
}

function handleRenameBoard(name: string) {
  store.renameBoard(activeBoardId.value, name);
  refresh();
}

function handleDeleteBoard() {
  store.deleteBoard(activeBoardId.value);
  const remaining = store.getBoards();
  if (remaining.length > 0) {
    navigateToBoard(remaining[0].id);
  }
  refresh();
}

function handleReorderCard(column: string, cardId: string, position: number) {
  store.reorderCard(activeBoardId.value, column, cardId, position);
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
  props: { board_count: boards.value.length, active_board: activeBoardId.value },
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
    boards.value.map((board) => {
      if (board.id === activeBoardId.value) return [board.id, { type: "view" }];
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
useSlop(slop, () => activeBoard.value?.id ?? "__none__", () => {
  const ab = activeBoard.value;
  if (!ab) return { type: "view" };
  return {
    type: "view",
    props: {
      name: ab.name,
      card_count: cards.value.length,
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
          const results = store.searchCards(activeBoardId.value, query as string);
          return results.map((c) => ({ id: c.id, title: c.title, column: c.column, priority: c.priority }));
        },
      },
    },
  };
});

const filteredCards = computed(() =>
  searchQuery.value
    ? store.searchCards(activeBoardId.value, searchQuery.value)
    : cards.value,
);

const detailCard = computed(() =>
  detailCardId.value ? cards.value.find((c) => c.id === detailCardId.value) : null,
);
</script>

<template>
  <div class="app">
    <header class="app-header">
      <div class="app-header-left">
        <h1 class="app-title">Kanban Board</h1>
        <BoardSwitcher
          :boards="boards"
          :activeBoardId="activeBoardId"
          @navigate="navigateToBoard"
          @createBoard="handleCreateBoard"
        />
      </div>
      <div class="app-header-right">
        <SearchBar :query="searchQuery" @update:query="searchQuery = $event" />
        <button class="btn-primary" @click="showCreate = true">
          + New Card
        </button>
      </div>
    </header>

    <div v-if="activeBoard" class="board" :key="`${activeBoardId}-${version}`">
      <Column
        v-for="(col, i) in activeBoard.columns"
        :key="col"
        :boardId="activeBoardId"
        :columnId="col"
        :position="i"
        :cards="filteredCards.filter((c) => c.column === col)"
        :allColumns="activeBoard.columns"
        @moveCard="handleMoveCard"
        @editCard="(cardId, updates) => handleEditCard(cardId, updates)"
        @deleteCard="handleDeleteCard"
        @reorderCard="handleReorderCard"
        @setDescription="(cardId, content) => handleSetDescription(cardId, content)"
        @openDetail="detailCardId = $event"
      />
    </div>

    <CreateCard
      v-if="showCreate && activeBoard"
      :columns="activeBoard.columns"
      @submit="(title, column, priority, due, description, tags) => { handleCreateCard(title, column, priority, due, description, tags); showCreate = false; }"
      @close="showCreate = false"
    />

    <CardDetail
      v-if="detailCard"
      :card="detailCard"
      :columns="activeBoard?.columns || []"
      @edit="(updates) => handleEditCard(detailCard!.id, updates)"
      @move="(column) => handleMoveCard(detailCard!.id, column)"
      @delete="handleDeleteCard(detailCard!.id)"
      @setDescription="(content) => handleSetDescription(detailCard!.id, content)"
      @close="detailCardId = null"
    />
  </div>
</template>
