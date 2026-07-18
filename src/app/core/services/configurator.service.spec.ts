import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CatalogService } from './catalog.service';
import { ConfiguratorService } from './configurator.service';
import { provideInMemoryDataAndStubAuth } from './testing';
import {
  Part,
  ProductFamily,
  ProductVariant,
} from '../models/catalog.model';

/**
 * ConfiguratorService tests — covers the live total computation, required
 * parts enforcement, and the reverse-match algorithm.
 *
 * The algorithm was improved so that:
 *   - Loading a variant via `loadFromVariant()` does NOT trigger a
 *     suggestion for that same variant (the user already knows).
 *   - Only required parts selected = no suggestion (user hasn't chosen yet).
 *   - Manual toggles clear the loaded-variant tracking so suggestions
 *     can reappear if the user's manual selection happens to match.
 */
describe('ConfiguratorService', () => {
  let catalog: CatalogService;
  let configurator: ConfiguratorService;

  const FAMILY_ID = 'fam-test';
  const PART_TOWER = 'pt-tower';
  const PART_CHUTE = 'pt-chute';
  const PART_MAT = 'pt-mat';
  const PART_ROOF = 'pt-roof';

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
    configurator = TestBed.inject(ConfiguratorService);

    const parts: Part[] = [
      { id: PART_TOWER, name: 'Tower', sku: 'TWR-CHS', category: 'structure', price: 920, required: true },
      { id: PART_CHUTE, name: 'Chute 3m', sku: 'CHT-3M', category: 'slide', price: 410 },
      { id: PART_MAT, name: 'Safety mat', sku: 'SM-4', category: 'safety', price: 240, required: true },
      { id: PART_ROOF, name: 'Canopy roof', sku: 'RF-1', category: 'roof', price: 175 },
    ];
    const family: ProductFamily = {
      id: FAMILY_ID, name: 'Test Tower', code: 'TST-TWR',
      category: 'slide', description: '', currency: 'USD', tags: [],
      images: [], availableParts: parts,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    const variants: ProductVariant[] = [
      {
        id: 'var-1', familyId: FAMILY_ID, label: 'Standard', sku: 'TST-STD',
        active: true,
        overrides: [
          { key: 'size', value: '3m' },
          { key: 'price', value: 1570 },
          { key: 'parts', value: [PART_TOWER, PART_CHUTE, PART_MAT] },
        ],
        createdAt: Date.now(), updatedAt: Date.now(),
      },
      {
        id: 'var-2', familyId: FAMILY_ID, label: 'Deluxe', sku: 'TST-DLX',
        active: true,
        overrides: [
          { key: 'size', value: '3m' },
          { key: 'price', value: 1745 },
          { key: 'parts', value: [PART_TOWER, PART_CHUTE, PART_MAT, PART_ROOF] },
        ],
        createdAt: Date.now(), updatedAt: Date.now(),
      },
    ];
    await catalog.replaceAll([family], variants);
  });

  it('seeds the synthetic family', () => {
    expect(catalog.families().length).toBe(1);
    expect(catalog.variants().length).toBe(2);
  });

  it('preselects required parts on setFamily()', () => {
    configurator.setFamily(FAMILY_ID);
    expect(configurator.selection().get(PART_TOWER)).toBe(1);
    expect(configurator.selection().get(PART_MAT)).toBe(1);
    expect(configurator.selection().get(PART_CHUTE)).toBeUndefined();
  });

  it('live total updates as parts are toggled', () => {
    configurator.setFamily(FAMILY_ID);
    expect(configurator.totalPrice()).toBe(1160); // Tower(920) + Mat(240)

    configurator.togglePart(PART_CHUTE);
    expect(configurator.totalPrice()).toBe(1570);

    configurator.togglePart(PART_CHUTE);
    expect(configurator.totalPrice()).toBe(1160);
  });

  it('required parts cannot be unset', () => {
    configurator.setFamily(FAMILY_ID);
    configurator.togglePart(PART_TOWER);
    expect(configurator.selection().get(PART_TOWER)).toBe(1);
  });

  it('quantity updates reflect in the total', () => {
    configurator.setFamily(FAMILY_ID);
    configurator.togglePart(PART_CHUTE);
    configurator.setQuantity(PART_CHUTE, 3);
    expect(configurator.totalPrice()).toBe(2390); // 920 + 240 + 3*410
  });

  it('does NOT suggest when only required parts are selected', () => {
    configurator.setFamily(FAMILY_ID);
    // Only required parts (Tower + Mat) — no optional choice made yet.
    const match = configurator.matchSuggestion();
    expect(match.kind).toBe('none');
  });

  it('detects exact match when optional parts match a variant', () => {
    configurator.setFamily(FAMILY_ID);
    configurator.togglePart(PART_CHUTE); // matches Standard variant
    const match = configurator.matchSuggestion();
    expect(match.kind).toBe('exact');
    if (match.kind === 'exact') {
      expect(match.product.sku).toBe('TST-STD');
    }
  });

  it('detects exact match for Deluxe variant with roof', () => {
    configurator.setFamily(FAMILY_ID);
    configurator.togglePart(PART_CHUTE);
    configurator.togglePart(PART_ROOF); // matches Deluxe variant
    const match = configurator.matchSuggestion();
    expect(match.kind).toBe('exact');
    if (match.kind === 'exact') {
      expect(match.product.sku).toBe('TST-DLX');
    }
  });

  it('reports partial match when one extra part is selected', () => {
    configurator.setFamily(FAMILY_ID);
    configurator.togglePart(PART_CHUTE);
    configurator.togglePart(PART_ROOF); // Chute + Roof → matches Deluxe exactly

    // Now remove roof — should be partial (close to Standard, missing nothing, but has extra roof... wait)
    // Actually: Tower + Mat (required) + Chute = exact Standard. Let's test a real partial.
    configurator.setFamily(FAMILY_ID);
    configurator.togglePart(PART_ROOF); // Only roof optional — doesn't match any variant exactly
    const match = configurator.matchSuggestion();
    // Tower + Mat + Roof: Standard has Tower+Mat+Chute → missing Chute, extra Roof = partial
    expect(match.kind).toBe('partial');
  });

  it('does NOT suggest the loaded variant back to the user', () => {
    configurator.loadFromVariant('var-1');
    // The user explicitly loaded var-1, so suggesting "exact match: var-1"
    // would be redundant. The algorithm skips var-1, but may suggest var-2
    // (Deluxe) as a partial match if it's close enough.
    const match = configurator.matchSuggestion();
    // Should NOT be an exact match for var-1.
    if (match.kind === 'exact') {
      expect(match.product.sku).not.toBe('TST-STD');
    }
    // 'none' or 'partial' (suggesting Deluxe) are both acceptable.
    expect(['none', 'partial']).toContain(match.kind);
  });

  it('suggests again after manual toggle clears loaded-variant tracking', () => {
    configurator.loadFromVariant('var-1');
    // Manually add roof — now the selection no longer matches var-1,
    // it matches var-2 (Deluxe).
    configurator.togglePart(PART_ROOF);
    const match = configurator.matchSuggestion();
    expect(match.kind).toBe('exact');
    if (match.kind === 'exact') {
      expect(match.product.sku).toBe('TST-DLX');
    }
  });

  it('clearOptional() keeps required parts and removes others', () => {
    configurator.setFamily(FAMILY_ID);
    configurator.togglePart(PART_CHUTE);
    configurator.clearOptional();
    expect(configurator.selection().get(PART_TOWER)).toBe(1);
    expect(configurator.selection().get(PART_MAT)).toBe(1);
    expect(configurator.selection().has(PART_CHUTE)).toBe(false);
  });
});
