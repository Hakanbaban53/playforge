import { Injectable, inject } from '@angular/core';
import { ReceiptLayoutService } from './receipt-layout.service';
import { InvoiceDefaultsService, InvoiceDefaults } from './invoice-defaults.service';
import { CurrencyService, CurrencyCode } from './currency.service';
import { FavoritesService } from './favorites.service';
import { LayoutElement } from '../models/receipt.model';

/**
 * App-settings bundle — JSON export & import for the four pieces of UI
 * state that are otherwise easy to lose on a wipe / device switch:
 *
 *   1. Receipt layout (drag-drop order, styles, custom elements)
 *   2. Invoice defaults (paper, currency, VAT, seller block, notes)
 *   3. Currency exchange rates + base currency
 *   4. Catalog favorites (variant IDs)
 *
 * JSON was picked over Excel because the four shapes are heterogeneous
 * (array of objects, flat object, rate map, string set). Encoding them
 * across multiple Excel sheets would lose type fidelity and complicate
 * round-tripping for no real benefit — these files are small and only
 * ever consumed by this app.
 *
 * Each section is OPTIONAL in an imported bundle, so a user can hand-edit
 * the JSON to apply just one piece. The validator reports per-section
 * errors; the applier skips invalid sections but still applies valid ones
 * (best-effort, partial-success model).
 */

const BUNDLE_VERSION = 1;
const BUNDLE_APP = 'PlayForge';

export interface AppSettingsBundle {
  version: 1;
  app: typeof BUNDLE_APP;
  exportedAt: number;
  receiptLayout?: LayoutElement[];
  invoiceDefaults?: InvoiceDefaults;
  currency?: { rates: Record<CurrencyCode, number>; base: CurrencyCode };
  favorites?: string[];
}

export interface AppSettingsSectionError {
  section: keyof AppSettingsBundle | 'bundle';
  message: string;
}

export interface AppSettingsImportResult {
  ok: boolean;
  bundle: AppSettingsBundle | null;
  errors: AppSettingsSectionError[];
  /** Sections that passed validation and will be applied. */
  validSections: (keyof AppSettingsBundle)[];
}

export interface AppSettingsApplyResult {
  applied: string[];
  skipped: string[];
}

@Injectable({ providedIn: 'root' })
export class AppSettingsService {
  private readonly receiptLayout = inject(ReceiptLayoutService);
  private readonly invoiceDefaults = inject(InvoiceDefaultsService);
  private readonly currencyService = inject(CurrencyService);
  private readonly favorites = inject(FavoritesService);

  /** Build the current settings as a JSON-ready object. */
  buildBundle(): AppSettingsBundle {
    return {
      version: BUNDLE_VERSION,
      app: BUNDLE_APP,
      exportedAt: Date.now(),
      receiptLayout: this.receiptLayout.layout(),
      invoiceDefaults: this.invoiceDefaults.defaults(),
      currency: {
        rates: this.currencyService.rates(),
        base: this.currencyService.base(),
      },
      favorites: Array.from(this.favorites.ids()),
    };
  }

  /** Serialize the bundle as a pretty-printed JSON Blob. */
  exportAsJson(): Blob {
    const json = JSON.stringify(this.buildBundle(), null, 2);
    return new Blob([json], { type: 'application/json;charset=utf-8' });
  }

  /**
   * Validate an uploaded JSON file. Never throws — every problem is
   * reported in `errors` so the UI can render a per-section table.
   */
  async validate(file: File): Promise<AppSettingsImportResult> {
    let text: string;
    try {
      text = await file.text();
    } catch {
      return this.fail('bundle', 'Failed to read file.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid JSON syntax.';
      return this.fail('bundle', msg);
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return this.fail('bundle', 'Top-level value must be a JSON object.');
    }

    const b = parsed as Partial<AppSettingsBundle>;
    const errors: AppSettingsSectionError[] = [];
    const validSections: (keyof AppSettingsBundle)[] = [];

    if (b.version !== BUNDLE_VERSION) {
      errors.push({
        section: 'bundle',
        message: `Unsupported bundle version "${b.version ?? '?'}". Expected ${BUNDLE_VERSION}.`,
      });
    }
    if (b.app !== BUNDLE_APP) {
      errors.push({
        section: 'bundle',
        message: `Bundle "app" must be "${BUNDLE_APP}". Got "${b.app ?? '?'}".`,
      });
    }

    // receiptLayout — must be a non-empty array of layout-shaped objects.
    if (b.receiptLayout !== undefined) {
      const err = this.validateLayout(b.receiptLayout);
      if (err) {
        errors.push({ section: 'receiptLayout', message: err });
      } else {
        validSections.push('receiptLayout');
      }
    }

    // invoiceDefaults — must be an object with the expected keys.
    if (b.invoiceDefaults !== undefined) {
      const err = this.validateDefaults(b.invoiceDefaults);
      if (err) {
        errors.push({ section: 'invoiceDefaults', message: err });
      } else {
        validSections.push('invoiceDefaults');
      }
    }

    // currency — must be { rates: {USD,TRY,EUR}, base: CurrencyCode }.
    if (b.currency !== undefined) {
      const err = this.validateCurrency(b.currency);
      if (err) {
        errors.push({ section: 'currency', message: err });
      } else {
        validSections.push('currency');
      }
    }

    // favorites — must be an array of strings.
    if (b.favorites !== undefined) {
      const err = this.validateFavorites(b.favorites);
      if (err) {
        errors.push({ section: 'favorites', message: err });
      } else {
        validSections.push('favorites');
      }
    }

    // Bundle-level errors block apply entirely.
    const hasBundleError = errors.some((e) => e.section === 'bundle');
    if (hasBundleError) {
      return { ok: false, bundle: null, errors, validSections: [] };
    }

    return {
      ok: true,
      bundle: b as AppSettingsBundle,
      errors,
      validSections,
    };
  }

  /**
   * Apply a validated bundle. Each valid section is applied; invalid
   * sections are skipped. Returns the lists of applied and skipped
   * section names so the UI can report a granular result.
   */
  async apply(bundle: AppSettingsBundle, sections: (keyof AppSettingsBundle)[]): Promise<AppSettingsApplyResult> {
    const applied: string[] = [];
    const skipped: string[] = [];

    if (sections.includes('receiptLayout') && bundle.receiptLayout) {
      await this.receiptLayout.replaceAll(bundle.receiptLayout);
      applied.push('receiptLayout');
    } else {
      skipped.push('receiptLayout');
    }

    if (sections.includes('invoiceDefaults') && bundle.invoiceDefaults) {
      await this.invoiceDefaults.update(bundle.invoiceDefaults);
      applied.push('invoiceDefaults');
    } else {
      skipped.push('invoiceDefaults');
    }

    if (sections.includes('currency') && bundle.currency) {
      const { rates, base } = bundle.currency;
      // setRate ignores USD; setBase persists.
      for (const code of Object.keys(rates) as CurrencyCode[]) {
        if (code !== 'USD') await this.currencyService.setRate(code, rates[code]);
      }
      await this.currencyService.setBase(base);
      applied.push('currency');
    } else {
      skipped.push('currency');
    }

    if (sections.includes('favorites') && bundle.favorites) {
      await this.favorites.replaceAll(bundle.favorites);
      applied.push('favorites');
    } else {
      skipped.push('favorites');
    }

    return { applied, skipped };
  }
  private validateLayout(value: unknown): string | null {
    if (!Array.isArray(value)) return 'Receipt layout must be an array.';
    const arr = value as unknown[];
    if (arr.length === 0) return 'Receipt layout cannot be empty.';
    for (let i = 0; i < arr.length; i++) {
      const el = arr[i];
      if (typeof el !== 'object' || el === null) {
        return `Layout element #${i + 1} is not an object.`;
      }
      const e = el as Partial<LayoutElement>;
      if (typeof e.id !== 'string' || !e.id) {
        return `Layout element #${i + 1} is missing a string "id".`;
      }
      if (typeof e.type !== 'string' || !e.type) {
        return `Layout element #${i + 1} ("${e.id}") is missing a "type".`;
      }
      if (typeof e.visible !== 'boolean') {
        return `Layout element #${i + 1} ("${e.id}") "visible" must be a boolean.`;
      }
    }
    return null;
  }

  private validateDefaults(value: unknown): string | null {
    if (typeof value !== 'object' || value === null) return 'Invoice defaults must be an object.';
    const d = value as Partial<InvoiceDefaults>;
    if (!['A4', 'A5', 'Letter'].includes(d.paperSize ?? '')) {
      return `"paperSize" must be one of A4, A5, Letter.`;
    }
    if (typeof d.currency !== 'string' || !d.currency) {
      return `"currency" must be a non-empty string.`;
    }
    if (typeof d.vatPercent !== 'number' || d.vatPercent < 0 || d.vatPercent > 100) {
      return `"vatPercent" must be a number between 0 and 100.`;
    }
    if (typeof d.sellerBlock !== 'string') return `"sellerBlock" must be a string.`;
    if (typeof d.notes !== 'string') return `"notes" must be a string.`;
    return null;
  }

  private validateCurrency(value: unknown): string | null {
    if (typeof value !== 'object' || value === null) return 'Currency section must be an object.';
    const c = value as { rates?: unknown; base?: unknown };
    if (typeof c.rates !== 'object' || c.rates === null) return `"rates" must be an object.`;
    const rates = c.rates as Record<string, unknown>;
    for (const code of ['USD', 'TRY', 'EUR']) {
      if (typeof rates[code] !== 'number' || !Number.isFinite(rates[code])) {
        return `"rates.${code}" must be a finite number.`;
      }
    }
    if (!['USD', 'TRY', 'EUR'].includes(c.base as string)) {
      return `"base" must be one of USD, TRY, EUR.`;
    }
    return null;
  }

  private validateFavorites(value: unknown): string | null {
    if (!Array.isArray(value)) return 'Favorites must be an array.';
    for (let i = 0; i < value.length; i++) {
      if (typeof value[i] !== 'string') {
        return `Favorites entry #${i + 1} must be a string.`;
      }
    }
    return null;
  }

  private fail(section: keyof AppSettingsBundle | 'bundle', message: string): AppSettingsImportResult {
    return {
      ok: false,
      bundle: null,
      errors: [{ section, message }],
      validSections: [],
    };
  }
}
