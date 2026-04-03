import { Component, input, output, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { Card } from "../types";

@Component({
  selector: "app-create-card",
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="modal-overlay" (click)="close.emit()">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <h2 class="modal-title">New Card</h2>
          <button class="modal-close" (click)="close.emit()">&times;</button>
        </div>

        <div class="modal-body">
          <div class="form-field">
            <label class="form-label">TITLE</label>
            <input
              class="form-input"
              type="text"
              [(ngModel)]="title"
              (keydown.enter)="handleSubmit()"
              placeholder="Card title..."
              autofocus
            />
          </div>

          <div class="form-row">
            <div class="form-field">
              <label class="form-label">COLUMN</label>
              <select class="form-select" [(ngModel)]="column">
                @for (col of columns(); track col) {
                  <option [value]="col">{{ col }}</option>
                }
              </select>
            </div>

            <div class="form-field">
              <label class="form-label">PRIORITY</label>
              <select class="form-select" [(ngModel)]="priority">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-field">
              <label class="form-label">DUE DATE</label>
              <input class="form-input" type="date" [(ngModel)]="due" />
            </div>

            <div class="form-field">
              <label class="form-label">TAGS</label>
              <input
                class="form-input"
                type="text"
                [(ngModel)]="tags"
                placeholder="tag1, tag2, ..."
              />
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-ghost" (click)="close.emit()">Cancel</button>
          <button class="btn-primary" (click)="handleSubmit()" [disabled]="!title.trim()">
            Create
          </button>
        </div>
      </div>
    </div>
  `,
})
export class CreateCardComponent {
  columns = input.required<string[]>();
  submit = output<{
    title: string;
    column?: string;
    priority?: Card["priority"];
    due?: string;
    description?: string;
    tags?: string[];
  }>();
  close = output<void>();

  title = "";
  column = "";
  priority: Card["priority"] = "medium";
  due = "";
  tags = "";

  ngOnInit() {
    const cols = this.columns();
    if (cols.length > 0 && !this.column) {
      this.column = cols[0];
    }
  }

  handleSubmit() {
    if (!this.title.trim()) return;
    this.submit.emit({
      title: this.title.trim(),
      column: this.column,
      priority: this.priority,
      due: this.due || undefined,
      description: undefined,
      tags: this.tags
        ? this.tags.split(",").map((t) => t.trim()).filter(Boolean)
        : undefined,
    });
  }
}
