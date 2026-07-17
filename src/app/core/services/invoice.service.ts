import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Invoice,
  InvoiceLine,
  InvoiceMeta,
  LineDiscount,
  TaxLine,
  lineTotal,
} from '../models/invoice.model';
import { StorageService } from './storage.service';
import { InvoiceDefaultsService } from './invoice-defaults.service';

/**
 * Invoice state service.
 *
 * Holds the "current working invoice" — the document the user is actively
 * building. Multiple invoices can be saved; this service exposes the active
 * one plus helpers to compute totals.
 *
 * All totals are derived from signals so the UI updates live without zone.js.
 */
@Injectable({ providedIn: 'root' })
export class InvoiceService {
  private readonly storage = inject(StorageService);
  private readonly defaultsService = inject(InvoiceDefaultsService);
  private readonly activeKey = 'invoice:active';
  private readonly savedKey = 'invoice:saved';

  private readonly _active = signal<Invoice>(this.loadActive());
  readonly active = this._active.asReadonly();

  private readonly _savedVersion = signal(0);
  readonly savedVersion = this._savedVersion.asReadonly();

  readonly subtotal = computed(() =>
    this._active().lines.reduce((sum, l) => sum + lineTotal(l), 0),
  );

  /** Active (enabled, non-zero) taxes on the current invoice. */
  readonly activeTaxes = computed(() =>
    this._active().meta.taxes.filter((t) => t.enabled && t.value !== 0),
  );

  /** Total tax amount. */
  readonly totalTax = computed(() =>
    this.activeTaxes().reduce((sum, tax) => {
      if (tax.type === 'fixed') return sum + tax.value;
      return sum + this.subtotal() * (tax.value / 100);
    }, 0),
  );

  /** Grand total = subtotal + totalTax. */
  readonly grandTotal = computed(() => this.subtotal() + this.totalTax());

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  addLine(line: InvoiceLine): void {
    this._active.update((inv) => ({
      ...inv,
      lines: [...inv.lines, line],
      updatedAt: Date.now(),
    }));
    this.persistActive();
  }

  updateLine(lineId: string, patch: Partial<InvoiceLine>): void {
    this._active.update((inv) => ({
      ...inv,
      lines: inv.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)),
      updatedAt: Date.now(),
    }));
    this.persistActive();
  }

  removeLine(lineId: string): void {
    this._active.update((inv) => ({
      ...inv,
      lines: inv.lines.filter((l) => l.id !== lineId),
      updatedAt: Date.now(),
    }));
    this.persistActive();
  }

  updateLineQuantity(lineId: string, quantity: number): void {
    const qty = Math.max(1, Math.floor(quantity));
    this.updateLine(lineId, { quantity: qty });
  }

  updateLineDiscount(lineId: string, discount: LineDiscount | undefined): void {
    this.updateLine(lineId, { discount });
  }

  updateMeta(patch: Partial<InvoiceMeta>): void {
    this._active.update((inv) => ({
      ...inv,
      meta: { ...inv.meta, ...patch },
      updatedAt: Date.now(),
    }));
    this.persistActive();
  }

  updateTax(taxId: string, patch: Partial<TaxLine>): void {
    this._active.update((inv) => ({
      ...inv,
      meta: {
        ...inv.meta,
        taxes: inv.meta.taxes.map((t) =>
          t.id === taxId ? { ...t, ...patch } : t,
        ),
      },
      updatedAt: Date.now(),
    }));
    this.persistActive();
  }

  addTax(): void {
    this._active.update((inv) => ({
      ...inv,
      meta: {
        ...inv.meta,
        taxes: [
          ...inv.meta.taxes,
          {
            id: crypto.randomUUID(),
            name: 'New Tax',
            type: 'percent',
            value: 0,
            enabled: true,
          },
        ],
      },
      updatedAt: Date.now(),
    }));
    this.persistActive();
  }

  removeTax(taxId: string): void {
    this._active.update((inv) => ({
      ...inv,
      meta: {
        ...inv.meta,
        taxes: inv.meta.taxes.filter((t) => t.id !== taxId),
      },
      updatedAt: Date.now(),
    }));
    this.persistActive();
  }

  clearLines(): void {
    this._active.update((inv) => ({ ...inv, lines: [], updatedAt: Date.now() }));
    this.persistActive();
  }

  /** Save the current invoice into the saved list and start a fresh one. */
  saveAndReset(): Invoice {
    const saved = this._active();
    const all = this.storage.read<Invoice[]>(this.savedKey, []);
    all.push(saved);
    this.storage.write(this.savedKey, all);
    this._savedVersion.update((v) => v + 1);
    this._active.set(this.freshInvoice());
    this.persistActive();
    return saved;
  }

  /**
   * Replace the active invoice with a previously-saved one (clones its id,
   * meta, and lines). Used by the "clone to editor" action on the customers
   * page. Does NOT mutate the saved list.
   */
  loadSaved(invoice: Invoice): void {
    this._active.set({
      ...invoice,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    this.persistActive();
  }

  /** Delete a previously-saved invoice by id. */
  deleteSaved(invoiceId: string): void {
    const all = this.storage.read<Invoice[]>(this.savedKey, []);
    const next = all.filter((inv) => inv.id !== invoiceId);
    this.storage.write(this.savedKey, next);
    this._savedVersion.update((v) => v + 1);
  }

  /**
   * Push a fully-formed invoice into the saved list without disturbing the
   * active draft. Used by the dev-mode mock data seeder to populate invoice
   * history; not part of the normal user flow (which goes through
   * `saveAndReset()`).
   */
  pushSaved(invoice: Invoice): void {
    const all = this.storage.read<Invoice[]>(this.savedKey, []);
    all.push(invoice);
    this.storage.write(this.savedKey, all);
    this._savedVersion.update((v) => v + 1);
  }

  /**
   * Replace the entire saved-invoice list. Used by the dev-mode mock data
   * seeder's wipe/refresh flow. Bumps `savedVersion` so reactive callers
   * re-evaluate. The active invoice is left untouched.
   */
  replaceAllSaved(invoices: Invoice[]): void {
    this.storage.write(this.savedKey, invoices);
    this._savedVersion.update((v) => v + 1);
  }

  /** Switch the active document between quote and invoice. Re-issues the
   *  document number with the appropriate prefix. */
  setDocType(docType: 'quote' | 'invoice'): void {
    this._active.update((inv) => ({
      ...inv,
      meta: {
        ...inv.meta,
        docType,
        invoiceNumber: this.renumber(inv.meta.invoiceNumber, docType),
      },
      updatedAt: Date.now(),
    }));
    this.persistActive();
  }

  /** Convert the active quote into an invoice — convenience wrapper that
   *  flips `docType` and re-numbers in one call. */
  convertToInvoice(): void {
    if (this._active().meta.docType === 'invoice') return;
    this.setDocType('invoice');
  }

  /** Replace the prefix of a document number (INV / QUO). */
  private renumber(currentNumber: string, docType: 'quote' | 'invoice'): string {
    const prefix = docType === 'quote' ? 'QUO' : 'INV';
    const other = docType === 'quote' ? 'INV' : 'QUO';
    if (currentNumber.startsWith(`${prefix}-`)) return currentNumber;
    if (currentNumber.startsWith(`${other}-`)) {
      return `${prefix}-${currentNumber.slice(other.length + 1)}`;
    }
    // Doesn't match either prefix — prepend ours.
    return `${prefix}-${currentNumber}`;
  }

  /** List previously saved invoices (depends on `savedVersion` so reactive
   *  callers re-evaluate when the list changes). */
  listSaved(): Invoice[] {
    // Read the version signal so computed() callers re-run on save/delete.
    this._savedVersion();
    const raw = this.storage.read<Invoice[]>(this.savedKey, []);
    // Backward-compat: invoices saved before the `docType` field was added
    // default to `'invoice'`. Same for the `customerId` field.
    return raw.map((inv) => ({
      ...inv,
      meta: {
        ...inv.meta,
        docType: inv.meta.docType ?? 'invoice',
      },
      lines: inv.lines.map((l) => ({ ...l })),
    }));
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private persistActive(): void {
    this.storage.write(this.activeKey, this._active());
  }

  private loadActive(): Invoice {
    const stored = this.storage.read<Invoice | null>(this.activeKey, null);
    if (stored) {
      // Backward-compat: pre-`docType` invoices default to 'invoice'.
      return {
        ...stored,
        meta: {
          ...stored.meta,
          docType: stored.meta.docType ?? 'invoice',
        },
      };
    }
    return this.freshInvoice();
  }

  private freshInvoice(docType: 'quote' | 'invoice' = 'invoice'): Invoice {
    const defaults = this.defaultsService.defaults();
    const today = new Date();
    const issueDate = today.toISOString().slice(0, 10);
    const due = new Date(today.getTime() + 30 * 24 * 3600 * 1000);
    const prefix = docType === 'quote' ? 'QUO' : 'INV';
    return {
      id: crypto.randomUUID(),
      meta: {
        docType,
        invoiceNumber: `${prefix}-${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}-${Math.floor(Math.random() * 9999)
          .toString()
          .padStart(4, '0')}`,
        issueDate,
        dueDate: due.toISOString().slice(0, 10),
        customerName: '',
        seller: defaults.sellerBlock,
        currency: defaults.currency,
        paperSize: defaults.paperSize,
        taxes: [
          {
            id: 'vat',
            name: 'VAT',
            type: 'percent',
            value: defaults.vatPercent,
            enabled: true,
          },
        ],
        notes: defaults.notes,
      },
      lines: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
}
