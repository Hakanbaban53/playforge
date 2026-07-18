import { Injectable, computed, inject, signal, effect, untracked } from '@angular/core';
import {
  Invoice,
  InvoiceLine,
  InvoiceMeta,
  LineDiscount,
  TaxLine,
  lineTotal,
} from '../models/invoice.model';
import { DataProvider, Collections } from './data-provider';
import { LocalDataProvider } from './local-data-provider';
import { InvoiceDefaultsService } from './invoice-defaults.service';
import { AuthService } from './auth.service';

/**
 * Invoice state service.
 *
 * Holds the "current working invoice" — the document the user is actively
 * building. Multiple invoices can be saved; this service exposes the active
 * one plus helpers to compute totals.
 *
 * All totals are derived from signals so the UI updates live without zone.js.
 *
 * Storage split:
 *   - Active invoice draft: stored as a single doc under `invoice:active`
 *     via `LocalDataProvider` — ALWAYS local, never synced to Firestore.
 *     This is the work-in-progress, NOT a saved record.
 *
 *   - Saved invoices: stored as a collection under `invoice:saved` via
 *     the swapped `DataProvider`. These ARE synced across devices when
 *     the user is signed in.
 *
 * Logout reset: on every logout (driven by `AuthService.logoutEpoch`),
 * the active invoice draft is replaced with a fresh one. Without this,
 * user A's half-finished invoice would still be on screen if user B
 * logged in on the same device — a real data-leakage risk.
 */
@Injectable({ providedIn: 'root' })
export class InvoiceService {
  private readonly data = inject(DataProvider);
  private readonly localData = inject(LocalDataProvider);
  private readonly defaultsService = inject(InvoiceDefaultsService);
  private readonly auth = inject(AuthService);

  /** Reactive view of the active invoice doc — ALWAYS local, never synced. */
  private readonly activeDoc = this.localData.doc<Invoice>(Collections.invoiceActive);
  /** Reactive view of the saved invoices collection — synced when logged in. */
  readonly savedInvoices = this.data.collection<Invoice>(Collections.invoiceSaved);

  /** Active invoice — falls back to a fresh invoice if the doc is empty. */
  readonly active = computed<Invoice>(() => this.activeDoc() ?? this.freshInvoice());

  readonly subtotal = computed(() =>
    this.active().lines.reduce((sum, l) => sum + lineTotal(l), 0),
  );

  readonly activeTaxes = computed(() =>
    this.active().meta.taxes.filter((t) => t.enabled && t.value !== 0),
  );

  readonly totalTax = computed(() =>
    this.activeTaxes().reduce((sum, tax) => {
      if (tax.type === 'fixed') return sum + tax.value;
      return sum + this.subtotal() * (tax.value / 100);
    }, 0),
  );

  readonly grandTotal = computed(() => this.subtotal() + this.totalTax());

  private readonly _savedVersion = signal(0);
  readonly savedVersion = this._savedVersion.asReadonly();

  constructor() {
    // Reset the active invoice draft on every logout. This clears any
    // in-progress invoice that belonged to the previous user — critical
    // for shared-device scenarios.
    //
    // IMPORTANT: this effect must ONLY track `logoutEpoch`. If it also
    // reads `activeDoc()` (without untracked), it creates a feedback
    // loop: every addLine() write to activeDoc re-triggers the effect,
    // which sees lines.length > 0 and replaces the invoice with a fresh
    // one — silently deleting the line the user just added.
    //
    // The `epoch > 0` guard ensures the initial effect run (epoch=0,
    // no logout has happened yet) does NOT wipe an existing draft that
    // was loaded from localStorage on page load.
    effect(() => {
      const epoch = this.auth.logoutEpoch();
      if (epoch === 0) return; // initial state — no logout has occurred
      untracked(() => {
        const current = this.activeDoc();
        if (current && current.lines.length > 0) {
          void this.localData.setDoc(Collections.invoiceActive, this.freshInvoice());
        }
      });
    });
  }

  // Mutations

  async addLine(line: InvoiceLine): Promise<void> {
    const inv = this.active();
    const updated: Invoice = {
      ...inv,
      lines: [...inv.lines, line],
      updatedAt: Date.now(),
    };
    await this.localData.setDoc(Collections.invoiceActive, updated);
  }

  async updateLine(lineId: string, patch: Partial<InvoiceLine>): Promise<void> {
    const inv = this.active();
    const updated: Invoice = {
      ...inv,
      lines: inv.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)),
      updatedAt: Date.now(),
    };
    await this.localData.setDoc(Collections.invoiceActive, updated);
  }

  async removeLine(lineId: string): Promise<void> {
    const inv = this.active();
    const updated: Invoice = {
      ...inv,
      lines: inv.lines.filter((l) => l.id !== lineId),
      updatedAt: Date.now(),
    };
    await this.localData.setDoc(Collections.invoiceActive, updated);
  }

  async updateLineQuantity(lineId: string, quantity: number): Promise<void> {
    const qty = Math.max(1, Math.floor(quantity));
    await this.updateLine(lineId, { quantity: qty });
  }

  async updateLineDiscount(lineId: string, discount: LineDiscount | undefined): Promise<void> {
    await this.updateLine(lineId, { discount });
  }

  async updateMeta(patch: Partial<InvoiceMeta>): Promise<void> {
    const inv = this.active();
    const updated: Invoice = {
      ...inv,
      meta: { ...inv.meta, ...patch },
      updatedAt: Date.now(),
    };
    await this.localData.setDoc(Collections.invoiceActive, updated);
  }

  async updateTax(taxId: string, patch: Partial<TaxLine>): Promise<void> {
    const inv = this.active();
    const updated: Invoice = {
      ...inv,
      meta: {
        ...inv.meta,
        taxes: inv.meta.taxes.map((t) =>
          t.id === taxId ? { ...t, ...patch } : t,
        ),
      },
      updatedAt: Date.now(),
    };
    await this.localData.setDoc(Collections.invoiceActive, updated);
  }

  async addTax(): Promise<void> {
    const inv = this.active();
    const updated: Invoice = {
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
    };
    await this.localData.setDoc(Collections.invoiceActive, updated);
  }

  async removeTax(taxId: string): Promise<void> {
    const inv = this.active();
    const updated: Invoice = {
      ...inv,
      meta: {
        ...inv.meta,
        taxes: inv.meta.taxes.filter((t) => t.id !== taxId),
      },
      updatedAt: Date.now(),
    };
    await this.localData.setDoc(Collections.invoiceActive, updated);
  }

  async clearLines(): Promise<void> {
    const inv = this.active();
    const updated: Invoice = { ...inv, lines: [], updatedAt: Date.now() };
    await this.localData.setDoc(Collections.invoiceActive, updated);
  }

  /** Save the current invoice into the saved list and start a fresh one. */
  async saveAndReset(): Promise<Invoice> {
    const saved = this.active();
    await this.data.setRecord(Collections.invoiceSaved, saved);
    await this.localData.setDoc(Collections.invoiceActive, this.freshInvoice());
    this._savedVersion.update((v) => v + 1);
    return saved;
  }

  /**
   * Replace the active invoice with a previously-saved one (clones its id,
   * meta, and lines). Used by the "clone to editor" action on the customers
   * page. Does NOT mutate the saved list.
   */
  async loadSaved(invoice: Invoice): Promise<void> {
    const clone: Invoice = {
      ...invoice,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await this.localData.setDoc(Collections.invoiceActive, clone);
  }

  async deleteSaved(invoiceId: string): Promise<void> {
    await this.data.removeRecord(Collections.invoiceSaved, invoiceId);
    this._savedVersion.update((v) => v + 1);
  }

  /**
   * Push a fully-formed invoice into the saved list without disturbing the
   * active draft. Used by the dev-mode mock data seeder to populate invoice
   * history; not part of the normal user flow (which goes through
   * `saveAndReset()`).
   */
  async pushSaved(invoice: Invoice): Promise<void> {
    await this.data.setRecord(Collections.invoiceSaved, invoice);
    this._savedVersion.update((v) => v + 1);
  }

  /**
   * Replace the entire saved-invoice list. Used by the dev-mode mock data
   * seeder's wipe/refresh flow. Bumps `savedVersion` so reactive callers
   * re-evaluate. The active invoice is left untouched.
   */
  async replaceAllSaved(invoices: Invoice[]): Promise<void> {
    await this.data.replaceCollection(Collections.invoiceSaved, invoices);
    this._savedVersion.update((v) => v + 1);
  }

  /** Switch the active document between quote and invoice. Re-issues the
   *  document number with the appropriate prefix. */
  async setDocType(docType: 'quote' | 'invoice'): Promise<void> {
    const inv = this.active();
    const updated: Invoice = {
      ...inv,
      meta: {
        ...inv.meta,
        docType,
        invoiceNumber: this.renumber(inv.meta.invoiceNumber, docType),
      },
      updatedAt: Date.now(),
    };
    await this.localData.setDoc(Collections.invoiceActive, updated);
  }

  /** Convert the active quote into an invoice — convenience wrapper that
   *  flips `docType` and re-numbers in one call. */
  async convertToInvoice(): Promise<void> {
    if (this.active().meta.docType === 'invoice') return;
    await this.setDocType('invoice');
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

  /** List previously saved invoices. Reactive — returns the live signal
   *  value, so callers wrapped in `computed()` re-run on save/delete. */
  listSaved(): Invoice[] {
    return this.savedInvoices().map((inv) => ({
      ...inv,
      meta: {
        ...inv.meta,
        docType: inv.meta.docType ?? 'invoice',
      },
      lines: inv.lines.map((l) => ({ ...l })),
    }));
  }

  // Internals

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
