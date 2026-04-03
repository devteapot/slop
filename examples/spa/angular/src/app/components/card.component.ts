import { Component, input, output, signal } from "@angular/core";
import type { Card } from "../types";
import { computeSalience } from "../salience";

const PRIORITY_LABELS: Record<string, string> = {
  critical: "CRIT",
  high: "HIGH",
  medium: "MED",
  low: "LOW",
};

@Component({
  selector: "app-card",
  standalone: true,
  template: `
    <div
      class="card"
      [class.card-pinned]="sal().pinned"
      [class.card-overdue]="isOverdue()"
      (click)="openDetail.emit(card().id)"
    >
      <div class="card-header">
        <span class="card-priority" [class]="'priority-' + card().priority">
          {{ priorityLabel() }}
        </span>
        <button
          class="card-menu-btn"
          (click)="toggleMenu($event)"
        >
          &#8942;
        </button>
      </div>

      <h3 class="card-title">{{ card().title }}</h3>

      <div class="card-footer">
        @if (card().due) {
          <span class="card-due" [class.overdue]="isOverdue()">
            {{ formatDue(card().due!) }}
          </span>
        }
        @if (card().tags.length > 0) {
          <div class="card-tags">
            @for (tag of card().tags; track tag) {
              <span class="card-tag">{{ tag }}</span>
            }
          </div>
        }
        @if (card().description) {
          <span class="card-has-desc">&#9776;</span>
        }
      </div>

      @if (showMenu()) {
        <div class="card-menu" (click)="$event.stopPropagation()">
          @for (col of otherColumns(); track col) {
            <button
              class="card-menu-item"
              (click)="handleMove(col)"
            >
              Move to {{ col }}
            </button>
          }
          <button
            class="card-menu-item danger"
            (click)="handleDelete()"
          >
            Delete
          </button>
        </div>
      }
    </div>
  `,
})
export class CardComponent {
  card = input.required<Card>();
  allColumns = input.required<string[]>();
  move = output<{ cardId: string; column: string }>();
  delete = output<string>();
  openDetail = output<string>();

  showMenu = signal(false);

  sal() {
    return computeSalience(this.card());
  }

  isOverdue() {
    const c = this.card();
    return c.due && new Date(c.due) < new Date() && c.column !== "done";
  }

  priorityLabel() {
    return PRIORITY_LABELS[this.card().priority];
  }

  otherColumns() {
    return this.allColumns().filter((c) => c !== this.card().column);
  }

  formatDue(due: string): string {
    const date = new Date(due);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  toggleMenu(event: Event) {
    event.stopPropagation();
    this.showMenu.update((v) => !v);
  }

  handleMove(col: string) {
    this.move.emit({ cardId: this.card().id, column: col });
    this.showMenu.set(false);
  }

  handleDelete() {
    this.delete.emit(this.card().id);
    this.showMenu.set(false);
  }
}
