import { Injectable, inject, computed } from '@angular/core';
import { DataProvider, Collections } from './data-provider';

/**
 * Per-user catalog favorites.
 *
 * Stored as a single doc (array of variant IDs) under `catalog:favorites`.
 * The catalog page reads `isFavorite(id)` and `onlyFavorites()` to filter
 * the grid; the star button on each card toggles via `toggle(id)`.
 *
 * When the user is signed in, favorites sync to Firestore; when signed
 * out, they live in localStorage. The DataProvider handles the swap.
 *
 * Note: we use the single-doc API rather than a collection because
 * favorites is conceptually one set per user, not a list of records.
 * Internally we represent it as `{ ids: string[] }`.
 */
interface FavoritesDoc {
  ids: string[];
}

@Injectable({ providedIn: 'root' })
export class FavoritesService {
  private readonly data = inject(DataProvider);

  /** Reactive set of favorited variant IDs. */
  readonly favoritesDoc = this.data.doc<FavoritesDoc>(Collections.favorites);

  readonly ids = computed<Set<string>>(() => {
    const doc = this.favoritesDoc();
    return new Set(doc?.ids ?? []);
  });

  readonly count = computed(() => this.ids().size);

  isFavorite(variantId: string): boolean {
    return this.ids().has(variantId);
  }

  /** Returns the new state. */
  async toggle(variantId: string): Promise<boolean> {
    const current = new Set(this.ids());
    if (current.has(variantId)) current.delete(variantId);
    else current.add(variantId);
    await this.data.setDoc<FavoritesDoc>(Collections.favorites, { ids: Array.from(current) });
    return current.has(variantId);
  }

  /** Replace the entire favorites list (used by settings import). */
  async replaceAll(ids: string[]): Promise<void> {
    const clean = ids.filter((id) => typeof id === 'string' && id.length > 0);
    await this.data.setDoc<FavoritesDoc>(Collections.favorites, { ids: clean });
  }

  /** Remove all favorites. */
  async clear(): Promise<void> {
    await this.data.setDoc<FavoritesDoc>(Collections.favorites, { ids: [] });
  }
}
