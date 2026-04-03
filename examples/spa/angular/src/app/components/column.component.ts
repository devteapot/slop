import { Component, input, output, computed } from "@angular/core";
import type { ItemDescriptor, NodeDescriptor } from "@slop-ai/core";
import { action, useSlop } from "@slop-ai/angular";
import { slop } from "../slop";
import type { Card } from "../types";
import { computeSalience } from "../salience";
import { CardComponent } from "./card.component";

const COLUMN_LABELS: Record<string, string> = {
  backlog: "Backlog",
  "in-progress": "In Progress",
  review: "Review",
  done: "Done",
  todo: "Todo",
  doing: "Doing",
};

const WINDOW_SIZE = 8;

@Component({
  selector: "app-column",
  standalone: true,
  imports: [CardComponent],
  template: `
    <section class="column">
      <div class="column-header">
        <h2 class="column-title">{{ label() }}</h2>
        <span class="column-count">{{ total() }}</span>
      </div>
      <div class="column-cards">
        @for (card of sorted(); track card.id) {
          <app-card
            [card]="card"
            [allColumns]="allColumns()"
            (move)="handleMove($event)"
            (delete)="handleDelete($event)"
            (openDetail)="openDetail.emit($event)"
          />
        }
        @if (total() === 0) {
          <p class="column-empty">No cards</p>
        }
      </div>
    </section>
  `,
})
export class ColumnComponent {
  boardId = input.required<string>();
  columnId = input.required<string>();
  position = input.required<number>();
  cards = input.required<Card[]>();
  allColumns = input.required<string[]>();
  moveCard = output<{ cardId: string; column: string }>();
  editCard = output<{ cardId: string; updates: Partial<Pick<Card, "title" | "priority" | "due" | "tags">> }>();
  deleteCard = output<string>();
  reorderCard = output<{ column: string; cardId: string; position: number }>();
  setDescription = output<{ cardId: string; content: string }>();
  openDetail = output<string>();

  sorted = computed(() =>
    [...this.cards()].sort((a, b) => a.position - b.position),
  );

  total = computed(() => this.sorted().length);

  label = computed(() => COLUMN_LABELS[this.columnId()] || this.columnId());

  constructor() {
    useSlop(slop, () => `${this.boardId()}/${this.columnId()}`, () => this.buildDescriptor());
  }

  private buildDescriptor(): NodeDescriptor {
    const sortedCards = this.sorted();
    const total = this.total();
    const label = this.label();
    const pos = this.position();
    const useWindow = total > WINDOW_SIZE;
    const windowed = sortedCards.slice(0, WINDOW_SIZE);
    const allCols = this.allColumns();
    const columnId = this.columnId();

    const buildItemDescriptor = (card: Card): ItemDescriptor => {
      const sal = computeSalience(card);
      const otherColumns = allCols.filter((c) => c !== card.column);

      const descriptor: ItemDescriptor = {
        id: card.id,
        props: {
          title: card.title,
          priority: card.priority,
          tags: card.tags,
          due: card.due,
          column: card.column,
        },
        meta: {
          salience: sal.salience,
          urgency: sal.urgency,
          reason: sal.reason,
          ...(sal.pinned ? { pinned: true } : {}),
        },
        actions: {
          edit: action(
            {
              title: { type: "string" },
              priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
              due: { type: "string", description: "ISO date string" },
              tags: { type: "string", description: "Comma-separated tags" },
            },
            ({ title, priority, due, tags }) => {
              const updates: Partial<Pick<Card, "title" | "priority" | "due" | "tags">> = {};
              if (title) updates.title = title;
              if (priority) updates.priority = priority as Card["priority"];
              if (due) updates.due = due;
              if (tags) {
                updates.tags = tags.split(",").map((t) => t.trim()).filter(Boolean);
              }
              this.editCard.emit({ cardId: card.id, updates });
            },
            { idempotent: true },
          ),
          move: action(
            {
              column: {
                type: "string",
                description: `Target column. One of: ${otherColumns.join(", ")}`,
              },
            },
            ({ column }) => this.moveCard.emit({ cardId: card.id, column }),
          ),
          delete: action(() => this.deleteCard.emit(card.id), { dangerous: true }),
          set_description: action(
            { content: { type: "string", description: "Markdown content" } },
            ({ content }) => this.setDescription.emit({ cardId: card.id, content }),
          ),
        },
      };

      if (card.description) {
        descriptor.contentRef = {
          type: "text" as const,
          mime: "text/markdown",
          size: card.description.length,
          summary: card.description.slice(0, 80).replace(/\n/g, " "),
          preview: card.description.slice(0, 200),
        };
      }

      return descriptor;
    };

    if (useWindow) {
      return {
        type: "collection",
        props: { name: label, position: pos, card_count: total },
        window: {
          items: windowed.map(buildItemDescriptor),
          total,
          offset: 0,
        },
        actions: {
          reorder: action(
            { card_id: "string", position: "number" },
            ({ card_id, position }) =>
              this.reorderCard.emit({ column: columnId, cardId: card_id, position }),
          ),
        },
      };
    }

    return {
      type: "collection",
      props: { name: label, position: pos, card_count: total },
      meta: { window: [0, total] as [number, number], total_children: total },
      items: sortedCards.map(buildItemDescriptor),
      actions: {
        reorder: action(
          { card_id: "string", position: "number" },
          ({ card_id, position }) =>
            this.reorderCard.emit({ column: columnId, cardId: card_id, position }),
        ),
      },
    };
  }

  handleMove(event: { cardId: string; column: string }) {
    this.moveCard.emit(event);
  }

  handleDelete(cardId: string) {
    this.deleteCard.emit(cardId);
  }
}
