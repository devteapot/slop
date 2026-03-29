import { Component, signal } from "@angular/core";
import { useSlop } from "@slop-ai/angular";
import { slop } from "../slop";

interface Widget {
  id: string;
  name: string;
  enabled: boolean;
  color: string;
}

@Component({
  selector: "app-root",
  standalone: true,
  template: `
    <div class="app">
      <h1>Dashboard</h1>
      <p class="subtitle">{{ widgets().filter(w => w.enabled).length }} of {{ widgets().length }} widgets active</p>

      <div class="grid">
        @for (widget of widgets(); track widget.id) {
          <div class="widget" [class.disabled]="!widget.enabled" [style.border-color]="widget.color">
            <div class="widget-header">
              <span class="widget-name">{{ widget.name }}</span>
              <button (click)="toggle(widget.id)">
                {{ widget.enabled ? 'Disable' : 'Enable' }}
              </button>
            </div>
            <div class="widget-body">
              @if (widget.enabled) {
                <span class="dot" [style.background]="widget.color"></span>
                Active
              } @else {
                <span class="off">Off</span>
              }
            </div>
          </div>
        }
      </div>

      <div class="add-form">
        <input #nameInput placeholder="Widget name..." (keydown.enter)="add(nameInput)" />
        <button (click)="add(nameInput)">Add Widget</button>
      </div>
    </div>
  `,
  styles: [`
    .app { max-width: 800px; margin: 0 auto; padding: 40px 20px; }
    h1 { font-size: 24px; margin-bottom: 4px; }
    .subtitle { color: #8b949e; font-size: 14px; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .widget { background: #161b22; border: 2px solid #30363d; border-radius: 8px; padding: 16px; transition: opacity 0.2s; }
    .widget.disabled { opacity: 0.5; }
    .widget-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .widget-name { font-weight: 600; font-size: 14px; }
    .widget-header button { background: #30363d; border: none; color: #8b949e; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; }
    .widget-header button:hover { background: #484f58; color: #e1e4e8; }
    .widget-body { font-size: 13px; color: #8b949e; display: flex; align-items: center; gap: 6px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; }
    .off { color: #484f58; }
    .add-form { display: flex; gap: 8px; }
    .add-form input { flex: 1; background: #0d1117; border: 1px solid #30363d; color: #e1e4e8; padding: 8px 12px; border-radius: 6px; font-size: 14px; }
    .add-form input:focus { outline: none; border-color: #58a6ff; }
    .add-form button { background: #238636; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; }
  `],
})
export class AppComponent {
  widgets = signal<Widget[]>([
    { id: "weather", name: "Weather", enabled: true, color: "#58a6ff" },
    { id: "news", name: "News Feed", enabled: true, color: "#f59e0b" },
    { id: "tasks", name: "Tasks", enabled: false, color: "#a855f7" },
    { id: "calendar", name: "Calendar", enabled: true, color: "#22c55e" },
  ]);

  private nextId = 5;

  constructor() {
    useSlop(slop, "dashboard", () => ({
      type: "view",
      props: {
        total: this.widgets().length,
        active: this.widgets().filter(w => w.enabled).length,
      },
      actions: {
        add_widget: {
          params: { name: "string" },
          handler: ({ name }) => {
            this.widgets.update(ws => [...ws, {
              id: `widget-${this.nextId++}`,
              name: name as string,
              enabled: true,
              color: "#6b7280",
            }]);
          },
        },
      },
      items: this.widgets().map(w => ({
        id: w.id,
        props: { name: w.name, enabled: w.enabled, color: w.color },
        actions: {
          toggle: () => this.toggle(w.id),
          remove: {
            handler: () => this.widgets.update(ws => ws.filter(x => x.id !== w.id)),
            dangerous: true,
          },
        },
      })),
    }));
  }

  toggle(id: string) {
    this.widgets.update(ws =>
      ws.map(w => w.id === id ? { ...w, enabled: !w.enabled } : w)
    );
  }

  add(input: HTMLInputElement) {
    const name = input.value.trim();
    if (!name) return;
    this.widgets.update(ws => [...ws, {
      id: `widget-${this.nextId++}`,
      name,
      enabled: true,
      color: "#6b7280",
    }]);
    input.value = "";
  }
}
