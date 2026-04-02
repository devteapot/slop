import { Component, input, output, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { Card } from "../types";

@Component({
  selector: "app-card-detail",
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="modal-overlay" (click)="close.emit()">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-header">
          @if (editingTitle()) {
            <input
              class="modal-title-input"
              [ngModel]="titleDraft()"
              (ngModelChange)="titleDraft.set($event)"
              (blur)="submitTitle()"
              (keydown.enter)="$any($event.target).blur()"
              (keydown.escape)="cancelTitleEdit()"
              autofocus
            />
          } @else {
            <h2 class="modal-title" (click)="startTitleEdit()">{{ card().title }}</h2>
          }
          <button class="modal-close" (click)="close.emit()">&times;</button>
        </div>

        <div class="modal-body">
          <div class="detail-row">
            <span class="detail-label">PRIORITY</span>
            <select
              class="detail-select"
              [ngModel]="card().priority"
              (ngModelChange)="edit.emit({ priority: $event })"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          <div class="detail-row">
            <span class="detail-label">COLUMN</span>
            <select
              class="detail-select"
              [ngModel]="card().column"
              (ngModelChange)="move.emit($event)"
            >
              @for (col of columns(); track col) {
                <option [value]="col">{{ col }}</option>
              }
            </select>
          </div>

          <div class="detail-row">
            <span class="detail-label">DUE DATE</span>
            <input
              class="detail-input"
              type="date"
              [ngModel]="card().due || ''"
              (ngModelChange)="edit.emit({ due: $event || null })"
            />
          </div>

          <div class="detail-row">
            <span class="detail-label">TAGS</span>
            <input
              class="detail-input"
              type="text"
              [ngModel]="card().tags.join(', ')"
              (ngModelChange)="handleTagsChange($event)"
              placeholder="tag1, tag2, ..."
            />
          </div>

          <div class="detail-description">
            <span class="detail-label">DESCRIPTION</span>
            @if (editingDesc()) {
              <div class="desc-editor">
                <textarea
                  class="desc-textarea"
                  [ngModel]="descDraft()"
                  (ngModelChange)="descDraft.set($event)"
                  rows="8"
                  autofocus
                ></textarea>
                <div class="desc-actions">
                  <button
                    class="btn-primary btn-sm"
                    (click)="saveDesc()"
                  >
                    Save
                  </button>
                  <button
                    class="btn-ghost btn-sm"
                    (click)="cancelDescEdit()"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            } @else {
              <div
                class="desc-preview"
                (click)="startDescEdit()"
              >
                @if (card().description) {
                  <pre class="desc-content">{{ card().description }}</pre>
                } @else {
                  <p class="desc-placeholder">Click to add a description...</p>
                }
              </div>
            }
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-danger" (click)="delete.emit()">Delete Card</button>
        </div>
      </div>
    </div>
  `,
})
export class CardDetailComponent {
  card = input.required<Card>();
  columns = input.required<string[]>();
  edit = output<Partial<Pick<Card, "title" | "priority" | "due" | "tags">>>();
  move = output<string>();
  delete = output<void>();
  setDescription = output<string>();
  close = output<void>();

  editingDesc = signal(false);
  descDraft = signal("");
  editingTitle = signal(false);
  titleDraft = signal("");

  startTitleEdit() {
    this.titleDraft.set(this.card().title);
    this.editingTitle.set(true);
  }

  submitTitle() {
    const draft = this.titleDraft().trim();
    if (draft && draft !== this.card().title) {
      this.edit.emit({ title: draft });
    }
    this.editingTitle.set(false);
  }

  cancelTitleEdit() {
    this.titleDraft.set(this.card().title);
    this.editingTitle.set(false);
  }

  startDescEdit() {
    this.descDraft.set(this.card().description);
    this.editingDesc.set(true);
  }

  saveDesc() {
    this.setDescription.emit(this.descDraft());
    this.editingDesc.set(false);
  }

  cancelDescEdit() {
    this.descDraft.set(this.card().description);
    this.editingDesc.set(false);
  }

  handleTagsChange(value: string) {
    this.edit.emit({
      tags: value.split(",").map((t) => t.trim()).filter(Boolean),
    });
  }
}
