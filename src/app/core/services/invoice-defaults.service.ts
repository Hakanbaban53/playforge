import { Injectable, inject, computed } from '@angular/core';
import { DataProvider, Collections } from './data-provider';
import { PaperSize } from '../models/invoice.model';

export interface InvoiceDefaults {
  paperSize: PaperSize;
  currency: string;
  vatPercent: number;
  sellerBlock: string;
  notes: string;
}

const DEFAULTS: InvoiceDefaults = {
  paperSize: 'A4',
  currency: 'USD',
  vatPercent: 20,
  sellerBlock: 'Your Company Name\n123 Park Avenue, Cityville\ninfo@example.com',
  notes: 'Payment due within 30 days. Thank you for your business!',
};

/**
 * Persisted invoice defaults — used by `InvoiceService` when creating a
 * fresh invoice, and editable from the Settings page.
 *
 * Stored as a single doc under `app:invoice-defaults`. Syncs to Firestore
 * when the user is signed in.
 */
@Injectable({ providedIn: 'root' })
export class InvoiceDefaultsService {
  private readonly data = inject(DataProvider);

  private readonly docSignal = this.data.doc<InvoiceDefaults>(Collections.invoiceDefaults);

  /** Reactive defaults — merges stored doc with built-in DEFAULTS so
   *  new fields added in future versions always have a sane value. */
  readonly defaults = computed<InvoiceDefaults>(() => {
    const stored = this.docSignal();
    return { ...DEFAULTS, ...(stored ?? {}) };
  });

  /** Update — merges with current and persists. */
  async update(patch: Partial<InvoiceDefaults>): Promise<void> {
    const next: InvoiceDefaults = { ...DEFAULTS, ...this.defaults(), ...patch };
    await this.data.setDoc(Collections.invoiceDefaults, next);
  }
}
