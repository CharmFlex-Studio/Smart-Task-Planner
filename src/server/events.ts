import type { VaultEvent } from '@shared/types.js';

type Listener = (event: VaultEvent) => void;

/**
 * A tiny in-process pub/sub, fanned out to browsers over SSE.
 *
 * This is what makes the vault feel live: edit a task in Obsidian, the watcher notices,
 * and the open browser tab updates without a refresh. The app is a *view* of your folder,
 * not an owner of it, and this is where that promise is kept.
 */
export class EventBus {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: VaultEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must never take down a write that already succeeded.
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}
