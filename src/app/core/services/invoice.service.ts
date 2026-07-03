import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Invoice,
  InvoiceLine,
  InvoiceMeta,
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

  /** Subtotal = Σ line.unitPrice × line.quantity. */
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
    this._active.set(this.freshInvoice());
    this.persistActive();
    return saved;
  }

  /** List previously saved invoices. */
  listSaved(): Invoice[] {
    return this.storage.read<Invoice[]>(this.savedKey, []);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private persistActive(): void {
    this.storage.write(this.activeKey, this._active());
  }

  private loadActive(): Invoice {
    const stored = this.storage.read<Invoice | null>(this.activeKey, null);
    if (stored) return stored;
    return this.freshInvoice();
  }

  private freshInvoice(): Invoice {
    const defaults = this.defaultsService.defaults();
    const today = new Date();
    const issueDate = today.toISOString().slice(0, 10);
    const due = new Date(today.getTime() + 30 * 24 * 3600 * 1000);
    return {
      id: crypto.randomUUID(),
      meta: {
        invoiceNumber: `INV-${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}-${Math.floor(Math.random() * 9999)
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
