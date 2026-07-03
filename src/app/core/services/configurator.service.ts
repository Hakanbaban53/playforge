import { Injectable, computed, inject, signal } from '@angular/core';
import {
  ConfigurationDraft,
  ConfiguredPart,
  MatchSuggestion,
  Part,
  ProductFamily,
  ResolvedProduct,
} from '../models/catalog.model';
import { CatalogService } from './catalog.service';

/**
 * Part-based configurator with live pricing and reverse catalog matching.
 *
 * The reverse-match algorithm works as follows:
 *
 *   1. When the user loads a variant via `loadFromVariant()`, the
 *      `_loadedVariantId` signal is set. The match suggestion will NOT
 *      suggest that same variant — the user already knows they're on it.
 *
 *   2. When the user manually toggles a part (add/remove/qty change),
 *      `_loadedVariantId` is cleared — the selection is now "custom" and
 *      the algorithm can suggest any variant (including the originally
 *      loaded one) if it happens to match.
 *
 *   3. The suggestion only appears when the user has selected at least one
 *      optional part (beyond the required defaults). Just having the
 *      required parts pre-selected is not enough to trigger a suggestion.
 */
@Injectable({ providedIn: 'root' })
export class ConfiguratorService {
  private readonly catalog = inject(CatalogService);

  private readonly _familyId = signal<string | null>(null);
  readonly familyId = this._familyId.asReadonly();

  private readonly _selection = signal<Map<string, number>>(new Map());
  readonly selection = this._selection.asReadonly();

  /**
   * Tracks the variant that was loaded via `loadFromVariant()`.
   * When non-null, the match suggestion skips this variant — the user
   * already knows they're on it. Cleared on any manual part toggle.
   */
  private readonly _loadedVariantId = signal<string | null>(null);

  readonly family = computed<ProductFamily | null>(() => {
    const id = this._familyId();
    if (!id) return null;
    return this.catalog.familyById().get(id) ?? null;
  });

  readonly availableParts = computed<Part[]>(() => {
    const fam = this.family();
    return fam?.availableParts ?? [];
  });

  readonly selectedPartsResolved = computed<{ part: Part; quantity: number }[]>(() => {
    const fam = this.family();
    if (!fam) return [];
    const sel = this._selection();
    const out: { part: Part; quantity: number }[] = [];
    for (const part of fam.availableParts) {
      const qty = sel.get(part.id);
      if (qty && qty > 0) out.push({ part, quantity: qty });
    }
    return out;
  });

  readonly totalPrice = computed<number>(() => {
    return this.selectedPartsResolved().reduce(
      (sum, { part, quantity }) => sum + part.price * quantity,
      0,
    );
  });

  readonly requiredSatisfied = computed<boolean>(() => {
    const fam = this.family();
    if (!fam) return false;
    const sel = this._selection();
    return fam.availableParts
      .filter((p) => p.required)
      .every((p) => (sel.get(p.id) ?? 0) > 0);
  });

  /**
   * Reverse-match suggestion against catalog variants.
   *
   * Rules:
   *   - No suggestion if no family is selected.
   *   - No suggestion if only required parts are selected (user hasn't
   *     made any meaningful choice yet).
   *   - Skip the variant that was loaded via `loadFromVariant()` —
   *     suggesting "you're on this variant" is redundant.
   *   - Exact match: all selected SKUs match a variant's SKUs exactly.
   *   - Partial match: closest variant by SKU delta, only if the delta
   *     is small enough to be useful (≤ 3 SKUs difference).
   */
  readonly matchSuggestion = computed<MatchSuggestion>(() => {
    const fam = this.family();
    if (!fam) return { kind: 'none' };

    const selectedParts = this.selectedPartsResolved();
    if (selectedParts.length === 0) return { kind: 'none' };

    // Don't suggest if only required parts are selected — user hasn't
    // made any optional choices yet.
    const hasOptionalParts = selectedParts.some(({ part }) => !part.required);
    if (!hasOptionalParts) return { kind: 'none' };

    const selectedSkus = new Set(selectedParts.map(({ part }) => part.sku));
    const loadedVariantId = this._loadedVariantId();

    const candidates = this.catalog.resolveByFamily(fam.id);
    let best: {
      product: ResolvedProduct;
      missing: string[];
      extra: string[];
    } | null = null;

    for (const product of candidates) {
      // Skip the variant that was explicitly loaded.
      if (product.variantId === loadedVariantId) continue;

      const variantSkus = new Set(product.parts.map((p) => p.sku));
      const missing = [...variantSkus].filter((s) => !selectedSkus.has(s));
      const extra = [...selectedSkus].filter((s) => !variantSkus.has(s));

      if (missing.length === 0 && extra.length === 0) {
        return { kind: 'exact', product };
      }

      // Only consider partial matches with a small delta — large deltas
      // aren't useful suggestions.
      const delta = missing.length + extra.length;
      if (delta > 3) continue;

      const bestScore = best ? best.missing.length + best.extra.length : Infinity;
      if (!best || delta < bestScore) {
        best = { product, missing, extra };
      }
    }

    if (!best) return { kind: 'none' };
    return {
      kind: 'partial',
      product: best.product,
      missingSkus: best.missing,
      extraSkus: best.extra,
    };
  });

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  /** Switch the active family. Resets selection. */
  setFamily(familyId: string): void {
    this._familyId.set(familyId);
    this._loadedVariantId.set(null);
    this.resetSelection();
  }

  /** Reset the part selection — required parts are auto-preselected. */
  resetSelection(): void {
    const fam = this.family();
    const next = new Map<string, number>();
    if (fam) {
      for (const part of fam.availableParts) {
        if (part.required) next.set(part.id, 1);
      }
    }
    this._selection.set(next);
    this._loadedVariantId.set(null);
  }

  /** Toggle a part on/off. Clears loaded-variant tracking. */
  togglePart(partId: string): void {
    const fam = this.family();
    const part = fam?.availableParts.find((p) => p.id === partId);
    if (!part) return;

    this._loadedVariantId.set(null);
    this._selection.update((map) => {
      const next = new Map(map);
      const current = next.get(partId) ?? 0;
      if (current > 0) {
        if (part.required) return next;
        next.delete(partId);
      } else {
        next.set(partId, 1);
      }
      return next;
    });
  }

  /** Set an explicit quantity. Clears loaded-variant tracking. */
  setQuantity(partId: string, quantity: number): void {
    const fam = this.family();
    const part = fam?.availableParts.find((p) => p.id === partId);
    if (!part) return;

    this._loadedVariantId.set(null);
    this._selection.update((map) => {
      const next = new Map(map);
      const qty = Math.max(0, Math.floor(quantity));
      if (qty <= 0) {
        if (part.required) next.set(partId, 1);
        else next.delete(partId);
      } else {
        next.set(partId, qty);
      }
      return next;
    });
  }

  /** Clear every non-required part. */
  clearOptional(): void {
    const fam = this.family();
    if (!fam) return;
    this._loadedVariantId.set(null);
    const next = new Map<string, number>();
    for (const part of fam.availableParts) {
      if (part.required) next.set(part.id, 1);
    }
    this._selection.set(next);
  }

  toDraft(): ConfigurationDraft | null {
    const familyId = this._familyId();
    if (!familyId) return null;
    const selectedParts: ConfiguredPart[] = [];
    for (const [partId, quantity] of this._selection().entries()) {
      if (quantity > 0) selectedParts.push({ partId, quantity });
    }
    return { familyId, selectedParts };
  }

  /**
   * Load a variant's parts into the configurator. Sets `_loadedVariantId`
   * so the match suggestion algorithm knows NOT to suggest this variant
   * back to the user (they explicitly chose it).
   */
  loadFromVariant(variantId: string): void {
    const resolved = this.catalog.resolve(variantId);
    if (!resolved) return;
    this._familyId.set(resolved.familyId);
    this._loadedVariantId.set(variantId);
    const next = new Map<string, number>();
    for (const part of resolved.parts) next.set(part.id, 1);
    const fam = this.catalog.familyById().get(resolved.familyId);
    if (fam) {
      for (const part of fam.availableParts) {
        if (part.required && !next.has(part.id)) next.set(part.id, 1);
      }
    }
    this._selection.set(next);
  }
}
