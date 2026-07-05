/**
 * Customer book entry.
 *
 * A customer is a reusable billing target — name, tax id, contact info,
 * address. Selecting a customer on the invoice page copies their fields
 * onto the invoice meta but does NOT link the invoice back to the customer
 * (other than via the optional `customerId` on `InvoiceMeta`).
 *
 * The list of saved invoices lives in `InvoiceService`, not here. This
 * service only owns the customer book.
 */
export interface Customer {
  id: string;
  name: string;
  taxId?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type CustomerInput = Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>;
