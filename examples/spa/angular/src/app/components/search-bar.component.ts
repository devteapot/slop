import { Component, input, output, model } from "@angular/core";
import { FormsModule } from "@angular/forms";

@Component({
  selector: "app-search-bar",
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="search-bar">
      <input
        type="text"
        placeholder="Search cards..."
        [ngModel]="query()"
        (ngModelChange)="queryChange.emit($event)"
      />
      @if (query()) {
        <button class="search-clear" (click)="queryChange.emit('')">
          &times;
        </button>
      }
    </div>
  `,
})
export class SearchBarComponent {
  query = input.required<string>();
  queryChange = output<string>();
}
