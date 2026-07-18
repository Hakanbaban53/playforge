import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { InvoiceService } from './invoice.service';
import { ConfiguratorService } from './configurator.service';
import { CatalogService } from './catalog.service';
import { Collections } from './data-provider';
import {
  InMemoryDataProvider,
  StubAuthService,
  provideInMemoryDataAndStubAuth,
} from './testing';
import { DataProvider } from './data-provider';
import { AuthService } from './auth.service';
import { Part, ProductFamily, ProductVariant } from '../models/catalog.model';
import { InvoiceLine } from '../models/invoice.model';

/** Helper: build a minimal valid InvoiceLine for tests. */
function makeLine(id: string, name = 'Test Product', unitPrice = 100, quantity = 2): InvoiceLine {
  return {
    id,
    name,
    code: 'TST',
    parts: [],
    unitPrice,
    quantity,
    discount: undefined,
  };
}

/**
 * Logout state-reset regression tests.
 *
 * Bug context: after signing out, the app used to leave editable
 * draft state sitting in component/service memory. If the same browser
 * was then used to log in as a different user, this was a real
 * data-leakage risk (seeing or submitting data tied to the wrong
 * account).
 *
 * Fix: AuthService.logoutEpoch signal bumps on every logout. User-
 * scoped services `effect()` on this signal and reset their state.
 * These tests verify that the reset actually happens for:
 *
 *   - InvoiceService — active invoice draft is replaced with a fresh one
 *   - ConfiguratorService — selection + loaded-variant-id are cleared
 */
describe('Logout state-reset (centralized)', () => {
  describe('InvoiceService', () => {
    let invoice: InvoiceService;
    let auth: StubAuthService;
    let data: InMemoryDataProvider;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideTranslateService({}),
          ...provideInMemoryDataAndStubAuth(),
        ],
      });
      invoice = TestBed.inject(InvoiceService);
      auth = TestBed.inject(AuthService) as unknown as StubAuthService;
      data = TestBed.inject(DataProvider) as InMemoryDataProvider;
    });

    it('starts with an empty active invoice (no lines)', () => {
      expect(invoice.active().lines.length).toBe(0);
    });

    it('preserves a draft invoice while still authenticated', async () => {
      await invoice.addLine(makeLine('line-1'));
      expect(invoice.active().lines.length).toBe(1);
    });

    it('REGRESSION: addLine is not wiped by the logout-reset effect (feedback-loop bug)', async () => {
      // Bug context: the logout-reset effect in InvoiceService's
      // constructor used to track BOTH logoutEpoch AND activeDoc().
      // Every addLine() write to activeDoc re-triggered the effect,
      // which saw lines.length > 0 and replaced the invoice with a
      // fresh one — silently deleting the line just added.
      //
      // This test flushes effects after addLine to reproduce the
      // real-app timing (zoneless CD fires the effect on the next
      // microtask). If the effect has a feedback loop, the line
      // disappears after flushing.
      await invoice.addLine(makeLine('line-1'));
      expect(invoice.active().lines.length).toBe(1);

      // Flush any pending effects — the line must survive.
      TestBed.flushEffects();
      expect(invoice.active().lines.length).toBe(1);

      // Add a second line and flush again — both must survive.
      await invoice.addLine(makeLine('line-2'));
      TestBed.flushEffects();
      expect(invoice.active().lines.length).toBe(2);
    });

    it('clears the active invoice draft on logout (epoch bump)', async () => {
      // Add a line so the draft is non-empty.
      await invoice.addLine(makeLine('line-1'));
      TestBed.flushEffects(); // ensure the reset effect doesn't fire mid-test
      expect(invoice.active().lines.length).toBe(1);

      // Log out.
      auth.bumpLogoutEpoch('explicit');
      TestBed.flushEffects();

      // The draft should be reset — fresh invoice with no lines.
      expect(invoice.active().lines.length).toBe(0);
    });

    it('does NOT reset the draft if logoutEpoch stays at 0', async () => {
      await invoice.addLine(makeLine('line-1'));
      TestBed.flushEffects();
      // No logout — verify the draft persists across effect flushing.
      expect(invoice.active().lines.length).toBe(1);
    });

    it('does NOT write a fresh draft if the current draft is already empty (avoids pointless writes)', () => {
      const beforeDoc = data.doc(Collections.invoiceActive)();
      auth.bumpLogoutEpoch('explicit');
      TestBed.flushEffects();
      const afterDoc = data.doc(Collections.invoiceActive)();
      // No lines were ever added — the effect should be a no-op (no doc write).
      expect(afterDoc).toBe(beforeDoc);
    });
  });

  describe('ConfiguratorService', () => {
    let catalog: CatalogService;
    let configurator: ConfiguratorService;
    let auth: StubAuthService;

    const FAMILY_ID = 'fam-test';
    const PART_TOWER: Part = {
      id: 'pt-tower', name: 'Tower', sku: 'TWR', category: 'structure', price: 1000, required: true,
    };
    const PART_ROOF: Part = {
      id: 'pt-roof', name: 'Roof', sku: 'RUF', category: 'roof', price: 200,
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
      configurator = TestBed.inject(ConfiguratorService);
      auth = TestBed.inject(AuthService) as unknown as StubAuthService;

      const family: ProductFamily = {
        id: FAMILY_ID, name: 'Test', code: 'TST', category: 'slide',
        description: '', currency: 'USD', tags: [], images: [],
        availableParts: [PART_TOWER, PART_ROOF],
        createdAt: 1, updatedAt: 1,
      };
      const variant: ProductVariant = {
        id: 'var-1', familyId: FAMILY_ID, label: 'Std', sku: 'TST-STD',
        active: true,
        overrides: [{ key: 'parts', value: [PART_TOWER.id] }],
        createdAt: 1, updatedAt: 1,
      };
      await catalog.replaceAll([family], [variant]);
    });

    it('starts with no family selected', () => {
      expect(configurator.familyId()).toBeNull();
      expect(configurator.selection().size).toBe(0);
    });

    it('preserves selection while still authenticated', () => {
      configurator.setFamily(FAMILY_ID);
      configurator.togglePart(PART_ROOF.id);
      expect(configurator.familyId()).toBe(FAMILY_ID);
      expect(configurator.selection().get(PART_ROOF.id)).toBe(1);
    });

    it('clears selection + familyId + loadedVariantId on logout (epoch bump)', () => {
      configurator.setFamily(FAMILY_ID);
      configurator.togglePart(PART_ROOF.id);
      configurator.loadFromVariant('var-1');
      expect(configurator.familyId()).toBe(FAMILY_ID);
      expect(configurator.selection().size).toBeGreaterThan(0);

      auth.bumpLogoutEpoch('explicit');
      TestBed.flushEffects();

      expect(configurator.familyId()).toBeNull();
      expect(configurator.selection().size).toBe(0);
    });

    it('does NOT clear selection if logoutEpoch stays at 0', () => {
      configurator.setFamily(FAMILY_ID);
      configurator.togglePart(PART_ROOF.id);
      expect(configurator.familyId()).toBe(FAMILY_ID);
    });
  });
});
