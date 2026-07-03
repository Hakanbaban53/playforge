import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Part,
  ProductCategory,
  ProductFamily,
  ProductVariant,
  ResolvedProduct,
  VariantOverride,
} from '../models/catalog.model';
import { StorageService } from './storage.service';

/**
 * Single source of truth for the catalog of families & variants.
 *
 * Responsibilities
 * ----------------
 * - Load/persist families & variants via `StorageService`.
 * - Resolve a variant into a `ResolvedProduct` by merging family defaults
 *   with variant overrides. This is the merge contract for the family +
 *   variant inheritance model.
 * - Provide computed lookups used across the app (by id, by sku, by family).
 *
 * The override-merge contract
 * ---------------------------
 * For each `VariantOverride` on a variant, the matching family attribute is
 * replaced wholesale (no deep-merge). For `parts`, the override is a list of
 * part IDs — the resolver looks them up against the family's `availableParts`
 * so the variant never has to duplicate part definitions.
 */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly storage = inject(StorageService);
  private readonly familiesKey = 'catalog:families';
  private readonly variantsKey = 'catalog:variants';

  /** Signal-backed catalog state. */
  private readonly _families = signal<ProductFamily[]>([]);
  private readonly _variants = signal<ProductVariant[]>([]);

  readonly families = this._families.asReadonly();
  readonly variants = this._variants.asReadonly();

  /** Convenience computed maps — O(1) lookups from anywhere in the UI. */
  readonly familyById = computed(() => {
    const map = new Map<string, ProductFamily>();
    for (const f of this._families()) map.set(f.id, f);
    return map;
  });

  readonly variantById = computed(() => {
    const map = new Map<string, ProductVariant>();
    for (const v of this._variants()) map.set(v.id, v);
    return map;
  });

  readonly variantsByFamily = computed(() => {
    const map = new Map<string, ProductVariant[]>();
    for (const v of this._variants()) {
      const list = map.get(v.familyId) ?? [];
      list.push(v);
      map.set(v.familyId, list);
    }
    return map;
  });

  constructor() {
    this.load();
  }

  /** Load (or initialize empty) the catalog from storage. */
  private load(): void {
    const storedFamilies = this.storage.read<ProductFamily[] | null>(
      this.familiesKey,
      null,
    );
    const storedVariants = this.storage.read<ProductVariant[] | null>(
      this.variantsKey,
      null,
    );

    if (storedFamilies && storedVariants) {
      this._families.set(storedFamilies);
      this._variants.set(storedVariants);
    } else {
      // First run — start with an empty catalog. The user adds products
      // via Catalog Management or imports them via the Excel wizard.
      this._families.set([]);
      this._variants.set([]);
      this.persist();
    }
  }

  /** Persist current state to storage. */
  private persist(): void {
    this.storage.write(this.familiesKey, this._families());
    this.storage.write(this.variantsKey, this._variants());
  }

  // ---------------------------------------------------------------------------
  // Family CRUD
  // ---------------------------------------------------------------------------

  addFamily(family: Omit<ProductFamily, 'id' | 'createdAt' | 'updatedAt'>): ProductFamily {
    const now = Date.now();
    const record: ProductFamily = {
      ...family,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this._families.update((list) => [...list, record]);
    this.persist();
    return record;
  }

  updateFamily(id: string, patch: Partial<ProductFamily>): void {
    this._families.update((list) =>
      list.map((f) =>
        f.id === id ? { ...f, ...patch, updatedAt: Date.now() } : f,
      ),
    );
    this.persist();
  }

  removeFamily(id: string): void {
    this._families.update((list) => list.filter((f) => f.id !== id));
    // Cascade: remove the family's variants too.
    this._variants.update((list) => list.filter((v) => v.familyId !== id));
    this.persist();
  }

  // ---------------------------------------------------------------------------
  // Variant CRUD
  // ---------------------------------------------------------------------------

  addVariant(variant: Omit<ProductVariant, 'id' | 'createdAt' | 'updatedAt'>): ProductVariant {
    const now = Date.now();
    const record: ProductVariant = {
      ...variant,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this._variants.update((list) => [...list, record]);
    this.persist();
    return record;
  }

  updateVariant(id: string, patch: Partial<ProductVariant>): void {
    this._variants.update((list) =>
      list.map((v) =>
        v.id === id ? { ...v, ...patch, updatedAt: Date.now() } : v,
      ),
    );
    this.persist();
  }

  removeVariant(id: string): void {
    this._variants.update((list) => list.filter((v) => v.id !== id));
    this.persist();
  }

  // ---------------------------------------------------------------------------
  // Resolution: variant -> ResolvedProduct
  // ---------------------------------------------------------------------------

  /** Resolve a single variant into a flat `ResolvedProduct`. */
  resolve(variantId: string): ResolvedProduct | null {
    const variant = this.variantById().get(variantId);
    if (!variant) return null;
    const family = this.familyById().get(variant.familyId);
    if (!family) return null;
    return this.merge(family, variant);
  }

  /** Resolve every active variant in the catalog. */
  resolveAll(): ResolvedProduct[] {
    return this._variants()
      .filter((v) => v.active)
      .map((v) => this.merge(this.familyById().get(v.familyId)!, v))
      .filter((r): r is ResolvedProduct => r !== null);
  }

  /** Resolve all variants belonging to a family. */
  resolveByFamily(familyId: string): ResolvedProduct[] {
    const family = this.familyById().get(familyId);
    if (!family) return [];
    return (this.variantsByFamily().get(familyId) ?? [])
      .filter((v) => v.active)
      .map((v) => this.merge(family, v));
  }

  /**
   * Core merge contract. Walks variant overrides and applies them on top of
   * family defaults. Anything not overridden is inherited.
   */
  private merge(family: ProductFamily, variant: ProductVariant): ResolvedProduct {
    const overrides = new Map<VariantOverride['key'], VariantOverride>();
    for (const ov of variant.overrides) overrides.set(ov.key, ov);

    // Resolve parts: either explicit override (list of part ids) or family default.
    const partOverride = overrides.get('parts');
    let parts: Part[];
    if (partOverride && partOverride.key === 'parts') {
      const byId = new Map(family.availableParts.map((p) => [p.id, p]));
      parts = partOverride.value
        .map((id) => byId.get(id))
        .filter((p): p is Part => p != null);
    } else {
      // Default: every available part is included (variants usually narrow this).
      parts = [...family.availableParts];
    }

    const size = overrides.get('size');
    const priceOv = overrides.get('price');
    const currencyOv = overrides.get('currency');
    const ageOv = overrides.get('ageRange');
    const descOv = overrides.get('description');
    const tagsOv = overrides.get('tags');
    const imagesOv = overrides.get('images');

    const price =
      priceOv && priceOv.key === 'price'
        ? priceOv.value
        : // Default price = sum of part prices. Variant override replaces it.
          parts.reduce((sum, p) => sum + p.price, 0);

    return {
      variantId: variant.id,
      familyId: family.id,
      name: family.name,
      code: family.code,
      sku: variant.sku,
      category: family.category,
      description:
        descOv && descOv.key === 'description' ? descOv.value : family.description,
      ageRange:
        ageOv && ageOv.key === 'ageRange' ? ageOv.value : family.ageRange,
      currency:
        currencyOv && currencyOv.key === 'currency'
          ? currencyOv.value
          : family.currency,
      tags: tagsOv && tagsOv.key === 'tags' ? tagsOv.value : [...family.tags],
      images:
        imagesOv && imagesOv.key === 'images' ? imagesOv.value : [...family.images],
      parts,
      price,
      size: size && size.key === 'size' ? size.value : undefined,
    };
  }

  /** Replace the entire catalog (used by the Excel import flow). */
  replaceAll(families: ProductFamily[], variants: ProductVariant[]): void {
    this._families.set(families);
    this._variants.set(variants);
    this.persist();
  }

  /** Hard reset — empty the catalog (used by Settings). */
  clearAll(): void {
    this._families.set([]);
    this._variants.set([]);
    this.persist();
  }

  /** True when storage has at least one family. */
  isSeeded(): boolean {
    return this._families().length > 0;
  }
}

/** Re-export the category type for convenient UI imports. */
export type { ProductCategory };
