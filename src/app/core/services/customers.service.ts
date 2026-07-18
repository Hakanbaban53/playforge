import { Injectable, computed, inject } from '@angular/core';
import { Customer, CustomerInput } from '../models/customer.model';
import { DataProvider, Collections } from './data-provider';
import { InvoiceService } from './invoice.service';

/**
 * Customer book — a reusable list of billing targets.
 *
 * Backed by `DataProvider` (which transparently swaps between local
 * localStorage and cloud Firestore based on auth state). The customer
 * list lives under the `customers` collection name.
 *
 * The customers page reads `customers()` for the list and the invoices
 * page calls `applyToInvoice()` to copy fields onto the active invoice meta.
 */
@Injectable({ providedIn: 'root' })
export class CustomersService {
  private readonly data = inject(DataProvider);
  private readonly invoiceService = inject(InvoiceService);

  /** Reactive customer list. Re-emits on local edits AND cloud sync. */
  readonly customers = this.data.collection<Customer>(Collections.customers);

  readonly customerById = computed(() => {
    const map = new Map<string, Customer>();
    for (const c of this.customers()) map.set(c.id, c);
    return map;
  });

  async add(input: CustomerInput): Promise<Customer> {
    const now = Date.now();
    const record: Customer = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    await this.data.setRecord(Collections.customers, record);
    return record;
  }

  async update(id: string, patch: Partial<CustomerInput>): Promise<void> {
    const existing = this.customerById().get(id);
    if (!existing) return;
    const updated: Customer = { ...existing, ...patch, updatedAt: Date.now() };
    await this.data.setRecord(Collections.customers, updated);
  }

  async remove(id: string): Promise<void> {
    await this.data.removeRecord(Collections.customers, id);
    // Clear dangling customerId on active invoice if it references this customer.
    const active = this.invoiceService.active();
    if (active.meta.customerId === id) {
      void this.invoiceService.updateMeta({ customerId: undefined });
    }
  }

  /** Remove all customers (used by replace-mode import and settings wipe). */
  async clearAll(): Promise<void> {
    await this.data.replaceCollection(Collections.customers, []);
  }

  getById(id: string): Customer | undefined {
    return this.customerById().get(id);
  }
}
