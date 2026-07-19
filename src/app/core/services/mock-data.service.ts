import { Injectable, inject } from '@angular/core';
import { CatalogService } from './catalog.service';
import { CustomersService } from './customers.service';
import { InvoiceService } from './invoice.service';
import { FavoritesService } from './favorites.service';
import { InvoiceDefaultsService } from './invoice-defaults.service';
import { FileStorageAdapter } from './file-storage.adapter';
import { ImageSyncQueueService } from './image-sync-queue.service';
import {
  Part,
  ProductFamily,
  VariantOverride,
} from '../models/catalog.model';
import { Customer } from '../models/customer.model';
import {
  Invoice,
  InvoiceLine,
  InvoiceMeta,
  TaxLine,
} from '../models/invoice.model';

/**
 * Dev-mode mock data seeder.
 *
 * Goal: in development it's tedious to hand-craft families, variants, parts,
 * customers, invoices, and favorites every time you reset localStorage. This
 * service exposes seed methods that inject realistic, cross-referenced mock
 * data in a single call — so the dev can click one button and have a fully
 * populated app to click around in.
 *
 * Production safety:
 *   - The component that surfaces this service (`DevToolsComponent`) only
 *     renders when `!environment.production`, so the seeder cannot be invoked
 *     in a shipped build.
 *   - The service itself is `providedIn: 'root'` (tree-shakeable) but every
 *     method is a no-op unless explicitly called.
 *
 * Idempotency:
 *   - Seed methods use deterministic SKU prefixes (e.g. `MOCK-SLD-*`) so they
 *     can detect existing mock data and skip re-seeding the same entities.
 *     Calling `seedCatalog()` twice does NOT duplicate mock families — it
 *     refreshes them by removing the prior mock batch first.
 *   - `seedAll()` orchestrates the four seeders in dependency order
 *     (catalog → customers → favorites → invoices) so cross-references
 *     resolve cleanly.
 */
@Injectable({ providedIn: 'root' })
export class MockDataService {
  private readonly catalog = inject(CatalogService);
  private readonly customers = inject(CustomersService);
  private readonly invoiceService = inject(InvoiceService);
  private readonly favorites = inject(FavoritesService);
  private readonly defaults = inject(InvoiceDefaultsService);
  private readonly fileStorage = inject(FileStorageAdapter);
  private readonly syncQueue = inject(ImageSyncQueueService);

  /** Prefix used on every mock family code so we can detect & refresh. */
  static readonly MOCK_PREFIX = 'MOCK-';
  static readonly MOCK_CUSTOMER_PREFIX = 'Mock • ';
  static readonly MOCK_INVOICE_PREFIX = 'INV-MOCK-';

  // Public seeding surface

  /**
   * Seed catalog: 3 families (slides, swings, climbing) each with parts +
   * 2-3 variants. Idempotent — re-running refreshes the mock batch.
   *
   * Returns the count of mock families now in storage (post-seed).
   */
  async seedCatalog(): Promise<number> {
    await this.clearMockFamilies();

    const families = this.buildMockFamilies();
    const variants = this.buildMockVariants(families);

    // The CatalogService's addFamily() generates its own id/timestamps, so
    // we feed it the family shape minus those fields. Parts are embedded on
    // the family record (availableParts) so they're added atomically.
    const createdFamilies: ProductFamily[] = [];
    for (const f of families) {
      const created = await this.catalog.addFamily({
        name: f.name,
        code: f.code,
        category: f.category,
        description: f.description,
        ageRange: f.ageRange,
        currency: f.currency,
        tags: f.tags,
        images: f.images,
        availableParts: f.availableParts,
      });
      createdFamilies.push(created);
    }

    // Variants reference familyId, so we map from the temp code → real id.
    const codeToFamilyId = new Map(createdFamilies.map((f) => [f.code, f.id]));
    for (const v of variants) {
      const familyId = codeToFamilyId.get(v.familyCode);
      if (!familyId) continue;
      await this.catalog.addVariant({
        familyId,
        label: v.label,
        sku: v.sku,
        active: v.active,
        overrides: v.overrides,
      });
    }

    return createdFamilies.length;
  }

  /**
   * Seed customers: 8 realistic-looking mock customers. Idempotent —
   * removes prior mock customers (those whose name starts with the mock
   * prefix) before inserting the fresh batch.
   */
  async seedCustomers(): Promise<number> {
    await this.clearMockCustomers();

    const samples = this.buildMockCustomers();
    for (const c of samples) {
      await this.customers.add(c);
    }
    return samples.length;
  }

  /**
   * Seed favorites: pick up to 3 mock catalog variants and mark them
   * favorite. Requires the catalog to have mock variants already; if not,
   * this method runs `seedCatalog()` first.
   */
  async seedFavorites(): Promise<number> {
    const mockVariants = this.catalog
      .variants()
      .filter((v) => v.sku.startsWith(MockDataService.MOCK_PREFIX));

    if (mockVariants.length === 0) {
      await this.seedCatalog();
    }

    const candidates = (this.catalog.variants() as readonly { id: string; sku: string }[])
      .filter((v) => v.sku.startsWith(MockDataService.MOCK_PREFIX))
      .slice(0, 3)
      .map((v) => v.id);

    // Merge with existing favorites (don't wipe the user's other picks).
    const existing = Array.from(this.favorites.ids());
    const merged = new Set(existing);
    for (const id of candidates) merged.add(id);

    await this.favorites.replaceAll(Array.from(merged));
    return candidates.length;
  }

  /**
   * Seed invoices: create 5 saved invoices that reference existing mock
   * variants + customers. Idempotent — removes prior mock invoices first.
   *
   * If no mock catalog or customers exist, runs the corresponding seeder
   * first so the cross-references resolve.
   */
  async seedInvoices(): Promise<number> {
    await this.clearMockInvoices();

    // Make sure dependencies are seeded.
    if (!this.hasMockFamilies()) await this.seedCatalog();
    if (!this.hasMockCustomers()) await this.seedCustomers();

    const mockCustomers = this.customers
      .customers()
      .filter((c) => c.name.startsWith(MockDataService.MOCK_CUSTOMER_PREFIX));

    const resolved = this.catalog.resolveAll().filter((r) =>
      r.sku.startsWith(MockDataService.MOCK_PREFIX),
    );

    if (resolved.length === 0 || mockCustomers.length === 0) return 0;

    const invoices = this.buildMockInvoices(resolved, mockCustomers);
    for (const inv of invoices) {
      await this.invoiceService.pushSaved(inv);
    }
    return invoices.length;
  }

  /** Convenience: seed everything in dependency order. */
  async seedAll(): Promise<{ families: number; customers: number; favorites: number; invoices: number }> {
    const families = await this.seedCatalog();
    const customers = await this.seedCustomers();
    const invoices = await this.seedInvoices();
    const favorites = await this.seedFavorites();
    return { families, customers, favorites, invoices };
  }

  /**
   * Wipe ALL app data — not just mock. This is the dev "reset to clean
   * slate" button. Removes every storage key the app owns and refreshes
   * the in-memory signals.
   *
   * We delegate to each service's clearAll()/resetToDefault() so the live
   * signals stay in sync with the storage state.
   */
  async wipeAll(): Promise<void> {
    await this.catalog.clearAll();
    await this.customers.clearAll();
    await this.favorites.clear();
    await this.clearAllSavedInvoices();
    await this.clearActiveInvoice();
    // Also wipe local IDB images + the sync queue so orphaned images
    // don't linger after a "reset to clean slate".
    await this.syncQueue.clear();
    await this.fileStorage.clearAll();
  }

  // Live counts (consumed by the DevTools UI)

  readonly counts = {
    families: () => this.catalog.families().length,
    variants: () => this.catalog.variants().length,
    customers: () => this.customers.customers().length,
    invoices: () => this.invoiceService.listSaved().length,
    favorites: () => this.favorites.count(),
  };

  // Mock data builders — kept private so the public surface stays minimal.

  private buildMockFamilies(): Omit<ProductFamily, 'id' | 'createdAt' | 'updatedAt'>[] {
    return [
      {
        name: 'Cascade Slide Tower',
        code: `${MockDataService.MOCK_PREFIX}CSC-TWR`,
        category: 'slide',
        description:
          'Tiered playground slide tower with multi-height chute options. ' +
          'Modular design — combine with roof and safety panels.',
        ageRange: '5-12 yrs',
        currency: 'USD',
        tags: ['outdoor', 'modular', 'commercial'],
        images: [],
        availableParts: [
          this.part('pt-csc-str', 'Tower chassis (3m)', 'CSC-STR-3M', 'structure', 480, true, 'Load-bearing steel frame'),
          this.part('pt-csc-chute-2', 'Slide chute (2m)', 'CSC-CHT-2M', 'slide', 220, false, 'Replacement 2m chute'),
          this.part('pt-csc-chute-3', 'Slide chute (3m)', 'CSC-CHT-3M', 'slide', 310, false, 'Replacement 3m chute'),
          this.part('pt-csc-chute-5', 'Slide chute (5m)', 'CSC-CHT-5M', 'slide', 460, false, 'Premium 5m chute'),
          this.part('pt-csc-roof', 'Canopy roof', 'CSC-ROOF', 'roof', 180, false, 'UV-resistant poly roof'),
          this.part('pt-csc-safety', 'Safety fall zone', 'CSC-SFT', 'safety', 95, true, 'Required rubber mat'),
        ],
      },
      {
        name: 'Sky Swing Frame',
        code: `${MockDataService.MOCK_PREFIX}SKY-SWG`,
        category: 'swing',
        description:
          'Heavy-duty A-frame swing set. Choose 2/3/4-bay configurations. ' +
          'Galvanized steel, powder-coated in your choice of color.',
        ageRange: '3-12 yrs',
        currency: 'USD',
        tags: ['outdoor', 'commercial', 'galvanized'],
        images: [],
        availableParts: [
          this.part('pt-sky-frame-2', 'A-frame (2-bay)', 'SKY-FR-2B', 'structure', 380, true, '2-bay galvanized frame'),
          this.part('pt-sky-frame-3', 'A-frame (3-bay)', 'SKY-FR-3B', 'structure', 520, false, '3-bay galvanized frame'),
          this.part('pt-sky-seat-std', 'Standard belt seat', 'SKY-ST-STD', 'swing', 35, false, 'UV-stable polymer seat'),
          this.part('pt-sky-seat-bucket', 'Bucket toddler seat', 'SKY-ST-BKT', 'swing', 60, false, 'High-back toddler seat'),
          this.part('pt-sky-chain', 'Chain assembly (1.8m)', 'SKY-CHN-18', 'swing', 28, false, 'Coated steel chain'),
          this.part('pt-sky-safety', 'Surface anchor kit', 'SKY-ANC', 'safety', 45, true, 'Required anchor kit'),
        ],
      },
      {
        name: 'Summit Climber',
        code: `${MockDataService.MOCK_PREFIX}SMT-CLM`,
        category: 'climbing',
        description:
          'Modular climbing wall with interchangeable panel styles. ' +
          'Suitable for school-age children; reinforced handholds.',
        ageRange: '6-14 yrs',
        currency: 'USD',
        tags: ['outdoor', 'inclusive', 'modular'],
        images: [],
        availableParts: [
          this.part('pt-smt-base', 'Climber base unit', 'SMT-BASE', 'structure', 410, true, 'Steel-reinforced base'),
          this.part('pt-smt-panel-easy', 'Panel: easy grip', 'SMT-PNL-E', 'climb', 130, false, 'Beginner-friendly holds'),
          this.part('pt-smt-panel-hard', 'Panel: advanced grip', 'SMT-PNL-A', 'climb', 150, false, 'Advanced holds'),
          this.part('pt-smt-net', 'Cargo net attachment', 'SMT-NET', 'climb', 175, false, 'Rope cargo net'),
          this.part('pt-smt-roof', 'Shade canopy', 'SMT-CNP', 'roof', 140, false, 'UV shade canopy'),
          this.part('pt-smt-safety', 'Crash pad set', 'SMT-PAD', 'safety', 110, true, 'Required fall pad set'),
        ],
      },
    ];
  }

  private buildMockVariants(
    families: Omit<ProductFamily, 'id' | 'createdAt' | 'updatedAt'>[],
  ): { familyCode: string; label: string; sku: string; active: boolean; overrides: VariantOverride[] }[] {
    const out: {
      familyCode: string;
      label: string;
      sku: string;
      active: boolean;
      overrides: VariantOverride[];
    }[] = [];

    const familyCodes = families.map((f) => f.code);

    for (const code of familyCodes) {
      const base = code.replace(MockDataService.MOCK_PREFIX, '');

      if (code === `${MockDataService.MOCK_PREFIX}CSC-TWR`) {
        out.push({
          familyCode: code,
          label: '2m Chute',
          sku: `${MockDataService.MOCK_PREFIX}${base}-2M`,
          active: true,
          overrides: [
            { key: 'size', value: '2m' },
            { key: 'price', value: 795 },
            { key: 'parts', value: ['pt-csc-str', 'pt-csc-chute-2', 'pt-csc-roof', 'pt-csc-safety'] },
          ],
        });
        out.push({
          familyCode: code,
          label: '3m Chute',
          sku: `${MockDataService.MOCK_PREFIX}${base}-3M`,
          active: true,
          overrides: [
            { key: 'size', value: '3m' },
            { key: 'price', value: 925 },
            { key: 'parts', value: ['pt-csc-str', 'pt-csc-chute-3', 'pt-csc-roof', 'pt-csc-safety'] },
          ],
        });
        out.push({
          familyCode: code,
          label: '5m Premium',
          sku: `${MockDataService.MOCK_PREFIX}${base}-5M`,
          active: true,
          overrides: [
            { key: 'size', value: '5m' },
            { key: 'price', value: 1180 },
            { key: 'parts', value: ['pt-csc-str', 'pt-csc-chute-5', 'pt-csc-roof', 'pt-csc-safety'] },
          ],
        });
      } else if (code === `${MockDataService.MOCK_PREFIX}SKY-SWG`) {
        out.push({
          familyCode: code,
          label: '2-bay Standard',
          sku: `${MockDataService.MOCK_PREFIX}${base}-2B-STD`,
          active: true,
          overrides: [
            { key: 'price', value: 510 },
            { key: 'parts', value: ['pt-sky-frame-2', 'pt-sky-seat-std', 'pt-sky-seat-std', 'pt-sky-chain', 'pt-sky-chain', 'pt-sky-safety'] },
          ],
        });
        out.push({
          familyCode: code,
          label: '3-bay Family',
          sku: `${MockDataService.MOCK_PREFIX}${base}-3B-FAM`,
          active: true,
          overrides: [
            { key: 'price', value: 740 },
            { key: 'parts', value: ['pt-sky-frame-3', 'pt-sky-seat-std', 'pt-sky-seat-std', 'pt-sky-seat-bucket', 'pt-sky-chain', 'pt-sky-chain', 'pt-sky-chain', 'pt-sky-safety'] },
          ],
        });
      } else if (code === `${MockDataService.MOCK_PREFIX}SMT-CLM`) {
        out.push({
          familyCode: code,
          label: 'Easy Grip',
          sku: `${MockDataService.MOCK_PREFIX}${base}-EASY`,
          active: true,
          overrides: [
            { key: 'price', value: 690 },
            { key: 'parts', value: ['pt-smt-base', 'pt-smt-panel-easy', 'pt-smt-roof', 'pt-smt-safety'] },
          ],
        });
        out.push({
          familyCode: code,
          label: 'Advanced',
          sku: `${MockDataService.MOCK_PREFIX}${base}-ADV`,
          active: true,
          overrides: [
            { key: 'price', value: 850 },
            { key: 'parts', value: ['pt-smt-base', 'pt-smt-panel-hard', 'pt-smt-net', 'pt-smt-safety'] },
          ],
        });
      }
    }

    return out;
  }

  private buildMockCustomers(): Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>[] {
    const prefix = MockDataService.MOCK_CUSTOMER_PREFIX;
    return [
      { name: `${prefix}Maple Grove Elementary`, taxId: 'US-55-1234567', email: 'procurement@maplegrove.edu', phone: '+1 (555) 204-1180', address: '1200 Maple Ave, Springfield, IL 62704', notes: 'PO required before delivery.' },
      { name: `${prefix}Sunrise Daycare Co.`, taxId: 'US-66-9876543', email: 'owner@sunrisedaycare.com', phone: '+1 (555) 663-9921', address: '45 Sunrise Blvd, Austin, TX 78701', notes: 'Prefers morning deliveries.' },
      { name: `${prefix}City of Lakeside Parks Dept`, taxId: 'GOV-CL-2024', email: 'parks@lakeside.gov', phone: '+1 (555) 771-0034', address: '1 Civic Center Dr, Lakeside, OR 97034', notes: 'Net-30 terms; signed receipt required.' },
      { name: `${prefix}Bright Futures Academy`, email: 'admin@brightfutures.edu', phone: '+1 (555) 880-2245', address: '300 Academy Way, Denver, CO 80202' },
      { name: `${prefix}Riverside HOA`, taxId: 'HOA-RV-448', email: 'board@riversidehoa.org', phone: '+1 (555) 412-7790', address: 'Riverside Community Center, 88 River Rd, Boise, ID 83702' },
      { name: `${prefix}Greenfield Montessori`, email: 'office@greenfield-montessori.org', phone: '+1 (555) 654-3308', address: '12 Greenfield Ln, Portland, ME 04101', notes: 'Allergies: latex — avoid latex-backed mats.' },
      { name: `${prefix}Adventure Playground LLC`, taxId: 'US-77-4455667', email: 'info@adventureplayground.com', phone: '+1 (555) 220-9087', address: '500 Adventure Way, San Diego, CA 92101' },
      { name: `${prefix}Pioneer Valley Preschool`, email: 'director@pioneervalley.org', phone: '+1 (555) 991-2210', address: '67 Pioneer St, Northampton, MA 01060', notes: 'Repeat customer — fall discount applied.' },
    ];
  }

  /**
   * Build 5 saved invoices spanning the last ~30 days, with varied line
   * counts, discount patterns, and tax configurations.
   */
  private buildMockInvoices(
    resolved: { variantId: string; familyId: string; name: string; code: string; sku: string; currency: string; parts: { id: string; name: string; sku: string; price: number }[]; price: number; size?: string }[],
    customers: Customer[],
  ): Invoice[] {
    const out: Invoice[] = [];
    const defaults = this.defaults.defaults();
    const now = Date.now();
    const day = 24 * 3600 * 1000;

    const picks = resolved.slice(0, Math.min(5, resolved.length));
    if (picks.length === 0) return out;

    // Cycle through customers so each invoice hits a different one.
    for (let i = 0; i < 5; i++) {
      const product = picks[i % picks.length];
      const customer = customers[i % customers.length];

      const issueDate = new Date(now - (5 - i) * 4 * day);
      const issueDateStr = issueDate.toISOString().slice(0, 10);
      const dueDate = new Date(issueDate.getTime() + 30 * day).toISOString().slice(0, 10);

      const qty = (i % 3) + 1;
      const discount = i === 1
        ? { type: 'percent' as const, value: 10 }
        : i === 3
          ? { type: 'fixed' as const, value: 50 }
          : undefined;

      const line: InvoiceLine = {
        id: crypto.randomUUID(),
        sourceVariantSku: product.sku,
        familyId: product.familyId,
        name: product.name,
        code: product.sku,
        parts: product.parts.map((p) => ({
          partId: p.id,
          name: p.name,
          sku: p.sku,
          unitPrice: p.price,
          quantity: 1,
        })),
        unitPrice: product.price,
        quantity: qty,
        discount,
        size: product.size,
      };

      const taxes: TaxLine[] = [
        { id: 'vat', name: 'VAT', type: 'percent', value: defaults.vatPercent, enabled: true },
      ];

      const meta: InvoiceMeta = {
        invoiceNumber: `${MockDataService.MOCK_INVOICE_PREFIX}${issueDate.getFullYear()}-${String(issueDate.getMonth() + 1).padStart(2, '0')}-${String(i + 1).padStart(3, '0')}`,
        docType: i === 2 ? 'quote' : 'invoice',
        issueDate: issueDateStr,
        dueDate,
        customerName: customer.name,
        customerEmail: customer.email,
        customerAddress: customer.address,
        customerTaxId: customer.taxId,
        customerId: customer.id,
        seller: defaults.sellerBlock,
        currency: defaults.currency,
        paperSize: (defaults.paperSize) || 'A4',
        taxes,
        notes: defaults.notes,
      };

      out.push({
        id: crypto.randomUUID(),
        meta,
        lines: [line],
        createdAt: issueDate.getTime(),
        updatedAt: issueDate.getTime(),
      });
    }

    return out;
  }

  // Mock-data cleanup helpers

  private async clearMockFamilies(): Promise<void> {
    const mockFamilyIds = this.catalog
      .families()
      .filter((f) => f.code.startsWith(MockDataService.MOCK_PREFIX))
      .map((f) => f.id);
    for (const id of mockFamilyIds) {
      await this.catalog.removeFamily(id);
    }
  }

  private async clearMockCustomers(): Promise<void> {
    const mockCustomerIds = this.customers
      .customers()
      .filter((c) => c.name.startsWith(MockDataService.MOCK_CUSTOMER_PREFIX))
      .map((c) => c.id);
    for (const id of mockCustomerIds) {
      await this.customers.remove(id);
    }
  }

  private async clearMockInvoices(): Promise<void> {
    const all = this.invoiceService.listSaved();
    const survivors = all.filter(
      (inv) => !inv.meta.invoiceNumber.startsWith(MockDataService.MOCK_INVOICE_PREFIX),
    );
    if (survivors.length !== all.length) {
      await this.invoiceService.replaceAllSaved(survivors);
    }
  }

  private async clearAllSavedInvoices(): Promise<void> {
    await this.invoiceService.replaceAllSaved([]);
  }

  private async clearActiveInvoice(): Promise<void> {
    // The active invoice always exists; clearing lines + resetting meta
    // is the closest thing to "wipe active" without breaking invariants.
    await this.invoiceService.clearLines();
  }

  // Predicates

  private hasMockFamilies(): boolean {
    return this.catalog.families().some((f) =>
      f.code.startsWith(MockDataService.MOCK_PREFIX),
    );
  }

  private hasMockCustomers(): boolean {
    return this.customers.customers().some((c) =>
      c.name.startsWith(MockDataService.MOCK_CUSTOMER_PREFIX),
    );
  }

  // Small private helpers

  private part(
    id: string,
    name: string,
    sku: string,
    category: Part['category'],
    price: number,
    required: boolean,
    description?: string,
  ): Part {
    return {
      id,
      name,
      sku,
      category,
      price,
      required,
      description,
    };
  }
}
