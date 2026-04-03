type Listener = (...args: any[]) => void;

export class Emitter {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, fn: Listener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
  }

  off(event: string, fn: Listener): void {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event: string, ...args: any[]): void {
    for (const fn of this.listeners.get(event) ?? []) fn(...args);
  }
}
