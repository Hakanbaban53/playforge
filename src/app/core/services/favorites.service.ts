import { Injectable, inject, signal, computed } from '@angular/core';
import { StorageService } from './storage.service';

/**
 * Per-user catalog favorites.
 *
 * Stored as a flat list of variant IDs under `pgpos:catalog:favorites`.
 * The catalog page reads `isFavorite(id)` and `onlyFavorites()` to filter
 * the grid; the star button on each card toggles via `toggle(id)`.
 *
 * Backed by localStorage so favorites survive reloads; no server needed.
 */
@Injectable({ providedIn: 'root' })
export class FavoritesService {
  private readonly storage = inject(StorageService);
  private readonly storageKey = 'catalog:favorites';

  private readonly _ids = signal<Set<string>>(this.load());
  /** Readonly set of favorited variant IDs. */
  readonly ids = this._ids.asReadonly();

  isFavorite(variantId: string): boolean {
    return this._ids().has(variantId);
  }

  /** Returns the new state. */
  toggle(variantId: string): boolean {
    const next = new Set(this._ids());
    if (next.has(variantId)) next.delete(variantId);
    else next.add(variantId);
    this._ids.set(next);
    this.persist();
    return next.has(variantId);
  }

  /** Replace the entire favorites list (used by settings import). */
  replaceAll(ids: string[]): void {
    const next = new Set(ids.filter((id) => typeof id === 'string' && id.length > 0));
    this._ids.set(next);
    this.persist();
  }

  /** Remove all favorites. */
  clear(): void {
    this._ids.set(new Set());
    this.persist();
  }

  readonly count = computed(() => this._ids().size);

  private load(): Set<string> {
    const arr = this.storage.read<string[]>(this.storageKey, []);
    return new Set(arr);
  }

  private persist(): void {
    this.storage.write(this.storageKey, Array.from(this._ids()));
  }
}
