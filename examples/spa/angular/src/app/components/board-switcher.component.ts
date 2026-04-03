import { Component, input, output, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { Board } from "../types";

@Component({
  selector: "app-board-switcher",
  standalone: true,
  imports: [FormsModule],
  template: `
    <nav class="board-switcher">
      @for (board of boards(); track board.id) {
        <button
          class="board-tab"
          [class.active]="board.id === activeBoardId()"
          (click)="navigate.emit(board.id)"
        >
          {{ board.name }}
        </button>
      }
      @if (creating()) {
        <span class="board-tab-create">
          <input
            class="board-tab-input"
            type="text"
            placeholder="Board name..."
            [(ngModel)]="newName"
            (keydown.enter)="handleSubmit()"
            autofocus
          />
          <button class="btn-ghost" (click)="handleSubmit()">&#10003;</button>
          <button class="btn-ghost" (click)="creating.set(false)">&times;</button>
        </span>
      } @else {
        <button class="board-tab add" (click)="creating.set(true)">+</button>
      }
    </nav>
  `,
})
export class BoardSwitcherComponent {
  boards = input.required<Board[]>();
  activeBoardId = input.required<string>();
  navigate = output<string>();
  createBoard = output<string>();

  creating = signal(false);
  newName = "";

  handleSubmit() {
    if (this.newName.trim()) {
      this.createBoard.emit(this.newName.trim());
      this.newName = "";
      this.creating.set(false);
    }
  }
}
