import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CatalogService } from './catalog.service';
import { InMemoryDataProvider, provideInMemoryDataAndStubAuth } from './testing';
import { DataProvider, Collections } from './data-provider';
import {
  Part,
  ProductFamily,
  ProductVariant,
} from '../models/catalog.model';

/**
 * CatalogService tests — covers the family+variant merge contract and
 * the defensive null-guards added during the Firestore snapshot-cascade
 * race-condition fix.
 *
 * The merge contract:
 *   - Variant overrides replace family defaults wholesale (no deep merge).
 *   - `parts` override is a list of part IDs; the resolver looks them up
 *     against the family's `availableParts`.
 *   - Default price = sum of selected part prices.
 *   - Tags and images default to family values when not overridden.
 *
 * Race-condition safety:
 *   - `resolveAll()` skips variants whose family isn't loaded yet
 *     (instead of throwing).
 *   - `merge()` guards against missing `availableParts` / `overrides`.
 */
describe('CatalogService', () => {
  let catalog: CatalogService;
  let data: InMemoryDataProvider;

  const PART_TOWER: Part = {
    id: 'pt-tower', name: 'Tower', sku: 'TWR-1', category: 'structure', price: 1000, required: true,
  };
  const PART_SLIDE: Part = {
    id: 'pt-slide', name: 'Slide', sku: 'SLD-1', category: 'slide', price: 400,
  };
  const PART_ROOF: Part = {
    id: 'pt-roof', name: 'Roof', sku: 'RUF-1', category: 'roof', price: 200,
  };

  const FAMILY: ProductFamily = {
    id: 'fam-1',
    name: 'Tower Family',
    code: 'TWR',
    category: 'slide',
    description: 'Default description',
    currency: 'USD',
    tags: ['outdoor', 'kids'],
    images: [{ id: 'img-1', url: 'https://example.com/family.jpg', alt: 'Family', isPrimary: true }],
    availableParts: [PART_TOWER, PART_SLIDE, PART_ROOF],
    createdAt: 1,
    updatedAt: 1,
  };

  const VARIANT_STANDARD: ProductVariant = {
    id: 'var-std',
    familyId: 'fam-1',
    label: 'Standard',
    sku: 'TWR-STD',
    active: true,
    overrides: [
      { key: 'parts', value: [PART_TOWER.id, PART_SLIDE.id] },
      { key: 'price', value: 1300 },
    ],
    createdAt: 1,
    updatedAt: 1,
  };

  const VARIANT_DELUXE: ProductVariant = {
    id: 'var-dlx',
    familyId: 'fam-1',
    label: 'Deluxe',
    sku: 'TWR-DLX',
    active: true,
    overrides: [
      { key: 'parts', value: [PART_TOWER.id, PART_SLIDE.id, PART_ROOF.id] },
      { key: 'price', value: 1500 },
      { key: 'description', value: 'Deluxe with roof' },
      { key: 'tags', value: ['outdoor', 'premium'] },
    ],
    createdAt: 1,
    updatedAt: 1,
  };

  const VARIANT_INACTIVE: ProductVariant = {
    id: 'var-old',
    familyId: 'fam-1',
    label: 'Discontinued',
    sku: 'TWR-OLD',
    active: false,
    overrides: [],
    createdAt: 1,
    updatedAt: 1,
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({}),
        ...provideInMemoryDataAndStubAuth(),
      ],
    });
    catalog = TestBed.inject(CatalogService);
    data = TestBed.inject(DataProvider) as InMemoryDataProvider;

    await data.replaceCollection(Collections.catalogFamilies, [FAMILY]);
    await data.replaceCollection(Collections.catalogVariants, [
      VARIANT_STANDARD,
      VARIANT_DELUXE,
      VARIANT_INACTIVE,
    ]);
  });

  describe('resolve() — merge contract', () => {
    it('uses variant price override when present', () => {
      const r = catalog.resolve('var-std');
      expect(r).not.toBeNull();
      expect(r!.price).toBe(1300);
    });

    it('falls back to sum-of-parts price when no price override', () => {
      const variantNoPrice: ProductVariant = {
        ...VARIANT_STANDARD,
        id: 'var-no-price',
        overrides: [{ key: 'parts', value: [PART_TOWER.id, PART_SLIDE.id] }],
      };
      void data.replaceCollection(Collections.catalogVariants, [variantNoPrice]);
      const r = catalog.resolve('var-no-price');
      // Tower(1000) + Slide(400) = 1400
      expect(r!.price).toBe(1400);
    });

    it('uses variant description override when present', () => {
      const r = catalog.resolve('var-dlx');
      expect(r!.description).toBe('Deluxe with roof');
    });

    it('falls back to family description when not overridden', () => {
      const r = catalog.resolve('var-std');
      expect(r!.description).toBe('Default description');
    });

    it('uses variant tags override when present (wholesale replace, not merge)', () => {
      const r = catalog.resolve('var-dlx');
      expect(r!.tags).toEqual(['outdoor', 'premium']);
      expect(r!.tags).not.toContain('kids');
    });

    it('falls back to family tags when not overridden', () => {
      const r = catalog.resolve('var-std');
      expect(r!.tags).toEqual(['outdoor', 'kids']);
    });

    it('uses variant parts override (subset of family availableParts)', () => {
      const r = catalog.resolve('var-dlx');
      expect(r!.parts.map((p) => p.id)).toEqual([
        PART_TOWER.id, PART_SLIDE.id, PART_ROOF.id,
      ]);
    });

    it('falls back to ALL family parts when no parts override', () => {
      const variantNoParts: ProductVariant = {
        ...VARIANT_STANDARD,
        id: 'var-no-parts',
        overrides: [],
      };
      void data.replaceCollection(Collections.catalogVariants, [variantNoParts]);
      const r = catalog.resolve('var-no-parts');
      expect(r!.parts.length).toBe(3);
    });

    it('returns null for unknown variant id', () => {
      expect(catalog.resolve('does-not-exist')).toBeNull();
    });

    it('returns null when variant exists but family is missing', () => {
      const orphanVariant: ProductVariant = {
        ...VARIANT_STANDARD,
        id: 'var-orphan',
        familyId: 'fam-missing',
      };
      void data.replaceCollection(Collections.catalogVariants, [orphanVariant]);
      expect(catalog.resolve('var-orphan')).toBeNull();
    });
  });

  describe('resolveAll() — race-condition safety', () => {
    it('resolves only active variants', () => {
      const all = catalog.resolveAll();
      expect(all.length).toBe(2); // Standard + Deluxe (inactive skipped)
      expect(all.map((r) => r.sku).sort()).toEqual(['TWR-DLX', 'TWR-STD']);
    });

    it('skips variants whose family is not loaded (no crash)', async () => {
      // Replace variants with one that references a non-existent family.
      await data.replaceCollection(Collections.catalogVariants, [
        { ...VARIANT_STANDARD, familyId: 'fam-missing' },
        VARIANT_DELUXE,
      ]);
      const all = catalog.resolveAll();
      // Only the Deluxe variant resolves (its family is loaded).
      expect(all.length).toBe(1);
      expect(all[0].sku).toBe('TWR-DLX');
    });

    it('handles missing overrides array defensively (no crash)', async () => {
      const variantNoOverrides = {
        ...VARIANT_STANDARD,
        id: 'var-no-ov',
        overrides: undefined as unknown as ProductVariant['overrides'],
      };
      await data.replaceCollection(Collections.catalogVariants, [variantNoOverrides]);
      const all = catalog.resolveAll();
      expect(all.length).toBe(1);
      // Default: all family parts included.
      expect(all[0].parts.length).toBe(3);
    });

    it('handles missing availableParts array defensively (no crash)', async () => {
      const familyNoParts: ProductFamily = {
        ...FAMILY,
        availableParts: undefined as unknown as ProductFamily['availableParts'],
      };
      await data.replaceCollection(Collections.catalogFamilies, [familyNoParts]);
      const all = catalog.resolveAll();
      expect(all.length).toBe(2);
      // All resolved products have empty parts arrays.
      expect(all.every((r) => r.parts.length === 0)).toBe(true);
    });
  });

  describe('resolveByFamily()', () => {
    it('returns all active variants for a family', () => {
      const products = catalog.resolveByFamily('fam-1');
      expect(products.length).toBe(2);
    });

    it('returns empty array for unknown family', () => {
      expect(catalog.resolveByFamily('does-not-exist')).toEqual([]);
    });
  });

  describe('lookup maps', () => {
    it('familyById provides O(1) family lookup', () => {
      expect(catalog.familyById().get('fam-1')).toEqual(FAMILY);
      expect(catalog.familyById().get('missing')).toBeUndefined();
    });

    it('variantById provides O(1) variant lookup', () => {
      expect(catalog.variantById().get('var-std')).toEqual(VARIANT_STANDARD);
    });

    it('variantsByFamily groups variants by familyId', () => {
      const grouped = catalog.variantsByFamily();
      expect(grouped.get('fam-1')!.length).toBe(3);
    });
  });
});
