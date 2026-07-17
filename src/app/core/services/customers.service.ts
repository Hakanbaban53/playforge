import { Injectable, computed, inject, signal } from '@angular/core';
import { Customer, CustomerInput } from '../models/customer.model';
import { StorageService } from './storage.service';
import { InvoiceService } from './invoice.service';

/**
 * Customer book — a reusable list of billing targets.
 *
 * Stored under `pgpos:customers` in localStorage. The `savedInvoices` list
 * lives in `InvoiceService` (separated by concern: this service owns the
 * customer Rolodex, that one owns the document history).
 *
 * The customers page reads `customers()` for the list and the invoices page
 * calls `applyToInvoice()` to copy fields onto the active invoice meta.
 */
@Injectable({ providedIn: 'root' })
export class CustomersService {
  private readonly storage = inject(StorageService);
  private readonly invoiceService = inject(InvoiceService);
  private readonly storageKey = 'customers';

  private readonly _customers = signal<Customer[]>(this.load());
  readonly customers = this._customers.asReadonly();

  readonly customerById = computed(() => {
    const map = new Map<string, Customer>();
    for (const c of this._customers()) map.set(c.id, c);
    return map;
  });

  add(input: CustomerInput): Customer {
    const now = Date.now();
    const record: Customer = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this._customers.update((list) => [...list, record]);
    this.persist();
    return record;
  }

  update(id: string, patch: Partial<CustomerInput>): void {
    this._customers.update((list) =>
      list.map((c) =>
        c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c,
      ),
    );
    this.persist();
  }

  remove(id: string): void {
    this._customers.update((list) => list.filter((c) => c.id !== id));
    this.persist();
    // Clear dangling customerId on active invoice if it references this customer.
    const active = this.invoiceService.active();
    if (active.meta.customerId === id) {
      this.invoiceService.updateMeta({ customerId: undefined });
    }
  }

  /** Remove all customers (used by replace-mode import and settings wipe). */
  clearAll(): void {
    this._customers.set([]);
    this.persist();
  }

  getById(id: string): Customer | undefined {
    return this.customerById().get(id);
  }

  private load(): Customer[] {
    return this.storage.read<Customer[]>(this.storageKey, []);
  }

  private persist(): void {
    this.storage.write(this.storageKey, this._customers());
  }
}
