import { Component, signal, computed } from "@angular/core";
import { useSlop } from "@slop-ai/angular";
import { slop } from "./slop";
import * as store from "./store";
import type { Board, Card } from "./types";
import { BoardSwitcherComponent } from "./components/board-switcher.component";
import { ColumnComponent } from "./components/column.component";
import { SearchBarComponent } from "./components/search-bar.component";
import { CreateCardComponent } from "./components/create-card.component";
import { CardDetailComponent } from "./components/card-detail.component";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    BoardSwitcherComponent,
    ColumnComponent,
    SearchBarComponent,
    CreateCardComponent,
    CardDetailComponent,
  ],
  template: `
    <div class="app">
      <header class="app-header">
        <div class="app-header-left">
          <h1 class="app-title">Kanban Board</h1>
          <app-board-switcher
            [boards]="boards()"
            [activeBoardId]="activeBoardId()"
            (navigate)="navigateToBoard($event)"
            (createBoard)="handleCreateBoard($event)"
          />
        </div>
        <div class="app-header-right">
          <app-search-bar
            [query]="searchQuery()"
            (queryChange)="searchQuery.set($event)"
          />
          <button class="btn-primary" (click)="showCreate.set(true)">
            + New Card
          </button>
        </div>
      </header>

      @if (activeBoard()) {
        <div class="board">
          @for (col of activeBoard()!.columns; track col; let i = $index) {
            <app-column
              [boardId]="activeBoardId()"
              [columnId]="col"
              [position]="i"
              [cards]="filteredCardsForColumn(col)"
              [allColumns]="activeBoard()!.columns"
              (moveCard)="handleMoveCard($event.cardId, $event.column)"
              (editCard)="handleEditCard($event.cardId, $event.updates)"
              (deleteCard)="handleDeleteCard($event)"
              (reorderCard)="handleReorderCard($event.column, $event.cardId, $event.position)"
              (setDescription)="handleSetDescription($event.cardId, $event.content)"
              (openDetail)="detailCardId.set($event)"
            />
          }
        </div>
      }

      @if (showCreate() && activeBoard()) {
        <app-create-card
          [columns]="activeBoard()!.columns"
          (submit)="handleCreateCardSubmit($event)"
          (close)="showCreate.set(false)"
        />
      }

      @if (detailCard()) {
        <app-card-detail
          [card]="detailCard()!"
          [columns]="activeBoard()?.columns || []"
          (edit)="handleEditCard(detailCard()!.id, $event)"
          (move)="handleMoveCard(detailCard()!.id, $event)"
          (delete)="handleDeleteCard(detailCard()!.id)"
          (setDescription)="handleSetDescription(detailCard()!.id, $event)"
          (close)="detailCardId.set(null)"
        />
      }
    </div>
  `,
})
export class AppComponent {
  boards = signal<Board[]>(store.getBoards());
  activeBoardId = signal(this.boards()[0]?.id || "");
  cards = signal<Card[]>(store.getCardsForBoard(this.activeBoardId()));
  searchQuery = signal("");
  showCreate = signal(false);
  detailCardId = signal<string | null>(null);
  version = signal(0);

  activeBoard = computed(() =>
    this.boards().find((b) => b.id === this.activeBoardId()),
  );

  filteredCards = computed(() => {
    const q = this.searchQuery();
    // read version to trigger recomputation
    this.version();
    return q
      ? store.searchCards(this.activeBoardId(), q)
      : this.cards();
  });

  detailCard = computed(() => {
    const id = this.detailCardId();
    return id ? this.cards().find((c) => c.id === id) ?? null : null;
  });

  constructor() {
    // SLOP: root node
    useSlop(slop, "/", () => ({
      type: "root",
      props: { board_count: this.boards().length, active_board: this.activeBoardId() },
      actions: {
        create_board: {
          params: { name: "string" },
          handler: ({ name }: Record<string, unknown>) =>
            this.handleCreateBoard(name as string),
        },
        navigate: {
          params: { board_id: "string" },
          idempotent: true,
          handler: ({ board_id }: Record<string, unknown>) =>
            this.navigateToBoard(board_id as string),
        },
      },
      children: Object.fromEntries(
        this.boards().map((board) => {
          if (board.id === this.activeBoardId()) return [board.id, { type: "view" }];
          return [
            board.id,
            {
              type: "view",
              props: { name: board.name },
              meta: { summary: this.buildBoardSummary(board) },
            },
          ];
        }),
      ),
    }));

    // SLOP: active board node (dynamic path — switches when navigating boards)
    useSlop(slop, () => this.activeBoardId() || "__none__", () => {
      const ab = this.activeBoard();
      if (!ab) return { type: "view" };
      return {
        type: "view",
        props: {
          name: ab.name,
          card_count: this.cards().length,
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
              const tagList = typeof tags === "string" ? (tags as string).split(",").map((t) => t.trim()).filter(Boolean) : undefined;
              this.handleCreateCard(
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
            handler: ({ name }: Record<string, unknown>) =>
              this.handleRenameBoard(name as string),
          },
          delete: {
            dangerous: true,
            handler: () => this.handleDeleteBoard(),
          },
          search: {
            params: { query: "string" },
            handler: ({ query }: Record<string, unknown>) => {
              const results = store.searchCards(this.activeBoardId(), query as string);
              return results.map((c) => ({ id: c.id, title: c.title, column: c.column, priority: c.priority }));
            },
          },
        },
      };
    });
  }

  private refresh() {
    this.boards.set(store.getBoards());
    this.cards.set(store.getCardsForBoard(this.activeBoardId()));
    this.version.update((v) => v + 1);
  }

  navigateToBoard(boardId: string) {
    this.activeBoardId.set(boardId);
    this.cards.set(store.getCardsForBoard(boardId));
    this.searchQuery.set("");
    this.detailCardId.set(null);
  }

  handleCreateBoard(name: string) {
    const board = store.createBoard(name);
    this.refresh();
    this.navigateToBoard(board.id);
  }

  handleCreateCard(
    title: string,
    column?: string,
    priority?: Card["priority"],
    due?: string,
    description?: string,
    tags?: string[],
  ) {
    store.createCard(this.activeBoardId(), title, column, priority, due, description, tags);
    this.refresh();
  }

  handleCreateCardSubmit(event: {
    title: string;
    column?: string;
    priority?: Card["priority"];
    due?: string;
    description?: string;
    tags?: string[];
  }) {
    this.handleCreateCard(
      event.title,
      event.column,
      event.priority,
      event.due,
      event.description,
      event.tags,
    );
    this.showCreate.set(false);
  }

  handleMoveCard(cardId: string, column: string) {
    store.moveCard(cardId, column);
    this.refresh();
  }

  handleEditCard(cardId: string, updates: Partial<Pick<Card, "title" | "priority" | "due" | "tags">>) {
    store.editCard(cardId, updates);
    this.refresh();
  }

  handleDeleteCard(cardId: string) {
    store.deleteCard(cardId);
    if (this.detailCardId() === cardId) this.detailCardId.set(null);
    this.refresh();
  }

  handleSetDescription(cardId: string, content: string) {
    store.setCardDescription(cardId, content);
    this.refresh();
  }

  handleRenameBoard(name: string) {
    store.renameBoard(this.activeBoardId(), name);
    this.refresh();
  }

  handleDeleteBoard() {
    store.deleteBoard(this.activeBoardId());
    const remaining = store.getBoards();
    if (remaining.length > 0) {
      this.navigateToBoard(remaining[0].id);
    }
    this.refresh();
  }

  handleReorderCard(column: string, cardId: string, position: number) {
    store.reorderCard(this.activeBoardId(), column, cardId, position);
    this.refresh();
  }

  filteredCardsForColumn(col: string): Card[] {
    return this.filteredCards().filter((c) => c.column === col);
  }

  private buildBoardSummary(board: Board): string {
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
}
