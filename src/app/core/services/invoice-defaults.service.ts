import { Injectable, inject, signal } from '@angular/core';
import { StorageService } from './storage.service';
import { PaperSize } from '../models/invoice.model';

export interface InvoiceDefaults {
  paperSize: PaperSize;
  currency: string;
  vatPercent: number;
  sellerBlock: string;
  notes: string;
}

const STORAGE_KEY = 'app:invoice-defaults';

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
 */
@Injectable({ providedIn: 'root' })
export class InvoiceDefaultsService {
  private readonly storage = inject(StorageService);

  private readonly _defaults = signal<InvoiceDefaults>(
    this.storage.read<InvoiceDefaults>(STORAGE_KEY, DEFAULTS),
  );
  readonly defaults = this._defaults.asReadonly();

  update(patch: Partial<InvoiceDefaults>): void {
    this._defaults.update((d) => {
      const next = { ...d, ...patch };
      this.storage.write(STORAGE_KEY, next);
      return next;
    });
  }
}
