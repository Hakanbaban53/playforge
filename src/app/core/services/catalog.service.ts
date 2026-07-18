import { Injectable, computed, inject } from '@angular/core';
import {
  Part,
  ProductCategory,
  ProductFamily,
  ProductVariant,
  ResolvedProduct,
  VariantOverride,
} from '../models/catalog.model';
import { DataProvider, Collections } from './data-provider';
import { UploadService } from './upload.service';

/**
 * Single source of truth for the catalog of families & variants.
 *
 * Backed by `DataProvider` — when the user is signed in, families and
 * variants sync to Firestore under `catalog:families` and
 * `catalog:variants` collections. When signed out, they live in
 * localStorage.
 *
 * Responsibilities
 * ----------------
 * - Load/persist families & variants via `DataProvider`.
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
  private readonly data = inject(DataProvider);
  private readonly uploadService = inject(UploadService);

  /** Signal-backed catalog state. */
  readonly families = this.data.collection<ProductFamily>(Collections.catalogFamilies);
  readonly variants = this.data.collection<ProductVariant>(Collections.catalogVariants);

  /** Convenience computed maps — O(1) lookups from anywhere in the UI. */
  readonly familyById = computed(() => {
    const map = new Map<string, ProductFamily>();
    for (const f of this.families()) map.set(f.id, f);
    return map;
  });

  readonly variantById = computed(() => {
    const map = new Map<string, ProductVariant>();
    for (const v of this.variants()) map.set(v.id, v);
    return map;
  });

  readonly variantsByFamily = computed(() => {
    const map = new Map<string, ProductVariant[]>();
    for (const v of this.variants()) {
      const list = map.get(v.familyId) ?? [];
      list.push(v);
      map.set(v.familyId, list);
    }
    return map;
  });

  private async deleteImagesFromUrls(urls: string[]): Promise<void> {
    await Promise.all(urls.map((url) => this.uploadService.delete(url)));
  }

  // ---------------------------------------------------------------------------
  // Family CRUD
  // ---------------------------------------------------------------------------

  async addFamily(family: Omit<ProductFamily, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProductFamily> {
    const now = Date.now();
    const record: ProductFamily = {
      ...family,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await this.data.setRecord(Collections.catalogFamilies, record);
    return record;
  }

  async updateFamily(id: string, patch: Partial<ProductFamily>): Promise<void> {
    const existing = this.familyById().get(id);
    if (!existing) return;

    if (patch.images) {
      const oldUrls = existing.images.map((img) => img.url);
      const newUrls = new Set(patch.images.map((img) => img.url));
      const deletedUrls = oldUrls.filter((url) => !newUrls.has(url));
      await this.deleteImagesFromUrls(deletedUrls);
    }

    const updated: ProductFamily = { ...existing, ...patch, updatedAt: Date.now() };
    await this.data.setRecord(Collections.catalogFamilies, updated);
  }

  async removeFamily(id: string): Promise<void> {
    const existing = this.familyById().get(id);
    if (existing) {
      const urls = existing.images.map((img) => img.url);
      await this.deleteImagesFromUrls(urls);
    }

    // Cascade: remove the family's variants too.
    const variants = this.variantsByFamily().get(id) ?? [];
    for (const v of variants) {
      const imgOverride = v.overrides.find((o) => o.key === 'images');
      if (imgOverride?.key === 'images') {
        const urls = imgOverride.value.map((img) => img.url);
        await this.deleteImagesFromUrls(urls);
      }
    }

    await this.data.removeRecord(Collections.catalogFamilies, id);
    await Promise.all(variants.map((v) => this.data.removeRecord(Collections.catalogVariants, v.id)));
  }

  // ---------------------------------------------------------------------------
  // Variant CRUD
  // ---------------------------------------------------------------------------

  async addVariant(variant: Omit<ProductVariant, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProductVariant> {
    const now = Date.now();
    const record: ProductVariant = {
      ...variant,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await this.data.setRecord(Collections.catalogVariants, record);
    return record;
  }

  async updateVariant(id: string, patch: Partial<ProductVariant>): Promise<void> {
    const existing = this.variantById().get(id);
    if (!existing) return;

    if (patch.overrides) {
      const oldImgOverride = existing.overrides.find((o) => o.key === 'images');
      const newImgOverride = patch.overrides.find((o) => o.key === 'images');

      if (oldImgOverride?.key === 'images') {
        const oldUrls = oldImgOverride.value.map((img) => img.url);
        const newUrls = new Set(
          newImgOverride?.key === 'images'
            ? newImgOverride.value.map((img) => img.url)
            : []
        );
        const deletedUrls = oldUrls.filter((url) => !newUrls.has(url));
        await this.deleteImagesFromUrls(deletedUrls);
      }
    }

    const updated: ProductVariant = { ...existing, ...patch, updatedAt: Date.now() };
    await this.data.setRecord(Collections.catalogVariants, updated);
  }

  async removeVariant(id: string): Promise<void> {
    const existing = this.variantById().get(id);
    if (existing) {
      const imgOverride = existing.overrides.find((o) => o.key === 'images');
      if (imgOverride?.key === 'images') {
        const urls = imgOverride.value.map((img) => img.url);
        await this.deleteImagesFromUrls(urls);
      }
    }
    await this.data.removeRecord(Collections.catalogVariants, id);
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

  /** Resolve every active variant in the catalog.
   *
   *  Race-condition safe: during Firestore snapshot cascades, the variants
   *  collection may emit before the families collection (or vice versa).
   *  We guard each lookup — variants whose family isn't loaded yet are
   *  skipped rather than crashing. They'll appear in a subsequent
   *  re-compute once both collections have emitted. */
  resolveAll(): ResolvedProduct[] {
    const familyById = this.familyById();
    return this.variants()
      .filter((v) => v.active)
      .map((v) => {
        const family = familyById.get(v.familyId);
        if (!family) return null;
        return this.merge(family, v);
      })
      .filter((r): r is ResolvedProduct => r !== null);
  }

  /** Resolve all variants belonging to a family. */
  resolveByFamily(familyId: string): ResolvedProduct[] {
    const family = this.familyById().get(familyId);
    if (!family) return [];
    return (this.variantsByFamily().get(familyId) ?? [])
      .filter((v) => v.active)
      .map((v) => this.merge(family, v))
      .filter((r): r is ResolvedProduct => r !== null);
  }

  /**
   * Core merge contract. Walks variant overrides and applies them on top of
   * family defaults. Anything not overridden is inherited.
   *
   * Defensive: guards against malformed/partial data (e.g. during Firestore
   * snapshot cascades where a document may be briefly incomplete). If
   * `family.availableParts` or `variant.overrides` is undefined, we fall
   * back to empty arrays rather than crashing.
   */
  private merge(family: ProductFamily, variant: ProductVariant): ResolvedProduct {
    const overrides = new Map<VariantOverride['key'], VariantOverride>();
    for (const ov of variant.overrides ?? []) overrides.set(ov.key, ov);

    // Resolve parts: either explicit override (list of part ids) or family default.
    const partOverride = overrides.get('parts');
    const familyParts = family.availableParts ?? [];
    let parts: Part[];
    if (partOverride?.key === 'parts') {
      const byId = new Map(familyParts.map((p) => [p.id, p]));
      parts = partOverride.value
        .map((id) => byId.get(id))
        .filter((p): p is Part => p != null);
    } else {
      // Default: every available part is included (variants usually narrow this).
      parts = [...familyParts];
    }

    const size = overrides.get('size');
    const priceOv = overrides.get('price');
    const currencyOv = overrides.get('currency');
    const ageOv = overrides.get('ageRange');
    const descOv = overrides.get('description');
    const tagsOv = overrides.get('tags');
    const imagesOv = overrides.get('images');

    const price =
      priceOv?.key === 'price'
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
        descOv?.key === 'description' ? descOv.value : family.description,
      ageRange:
        ageOv?.key === 'ageRange' ? ageOv.value : family.ageRange,
      currency:
        currencyOv?.key === 'currency'
          ? currencyOv.value
          : family.currency,
      tags: tagsOv?.key === 'tags' ? tagsOv.value : [...(family.tags ?? [])],
      images:
        imagesOv?.key === 'images' ? imagesOv.value : [...(family.images ?? [])],
      parts,
      price,
      size: size?.key === 'size' ? size.value : undefined,
    };
  }

  /** Replace the entire catalog (used by the Excel import flow). */
  async replaceAll(families: ProductFamily[], variants: ProductVariant[]): Promise<void> {
    await Promise.all([
      this.data.replaceCollection(Collections.catalogFamilies, families),
      this.data.replaceCollection(Collections.catalogVariants, variants),
    ]);
  }

  /** Hard reset — empty the catalog (used by Settings). */
  async clearAll(): Promise<void> {
    await this.replaceAll([], []);
  }

  /** True when storage has at least one family. */
  isSeeded(): boolean {
    return this.families().length > 0;
  }
}

/** Re-export the category type for convenient UI imports. */
export type { ProductCategory };
