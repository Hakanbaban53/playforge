import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { CustomersService } from '../../core/services/customers.service';
import { InvoiceService } from '../../core/services/invoice.service';
import { I18nService } from '../../core/services/i18n.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { ToastService } from '../../core/services/toast.service';
import { Customer } from '../../core/models/customer.model';
import { Invoice, lineTotal } from '../../core/models/invoice.model';
import { IconComponent } from '../../shared/components/icon.component';
import { ButtonComponent } from '../../shared/components/button.component';
import { MoneyPipe } from '../../shared/pipes/money.pipe';

/**
 * Customers page — a customer book plus the saved-invoice history.
 *
 * Two columns: customers (CRUD) on the left, saved invoices on the right.
 * Clicking "Use for active invoice" on a customer copies their fields onto
 * the active invoice meta. Clicking "Clone to editor" on a saved invoice
 * loads that invoice back into the editor (with a new id).
 */
@Component({
  selector: 'app-customers-page',
  standalone: true,
  imports: [IconComponent, ButtonComponent, MoneyPipe, TranslatePipe],
  templateUrl: './customers-page.html',
  styleUrl: './customers-page.scss',
})
export class CustomersPage {
  private readonly customersSvc = inject(CustomersService);
  private readonly invoiceSvc = inject(InvoiceService);
  private readonly i18n = inject(I18nService);
  private readonly confirmSvc = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly customers = this.customersSvc.customers;
  readonly savedInvoices = computed<Invoice[]>(() => {
    // Depend on the version signal so this re-runs whenever a new invoice
    // is saved or a saved one is deleted.
    this.invoiceSvc.savedVersion();
    return this.invoiceSvc.listSaved().slice().reverse();
  });

  /** Id of the customer currently being edited (null = creating new). */
  readonly editingId = signal<string | null>(null);
  readonly isCreating = signal(false);

  /** IDs of customers/saved-invoices currently playing their exit animation.
   *  Kept in the DOM (via the `@if` render condition) until the animation
   *  completes, then the underlying service actually removes the record. */
  readonly leavingCustomerIds = signal<ReadonlySet<string>>(new Set());
  readonly leavingInvoiceIds = signal<ReadonlySet<string>>(new Set());

  readonly fName = signal('');
  readonly fTaxId = signal('');
  readonly fEmail = signal('');
  readonly fPhone = signal('');
  readonly fAddress = signal('');
  readonly fNotes = signal('');

  readonly isEmpty = computed(() => this.customers().length === 0);

  /** Total amount for a saved invoice, formatted in its currency. */
  savedInvoiceTotal(inv: Invoice): number {
    return inv.lines.reduce((sum, l) => sum + lineTotal(l), 0);
  }

  /** Customer name to show on a saved invoice card. */
  savedInvoiceCustomer(inv: Invoice): string {
    return inv.meta.customerName || this.i18n.t('customers.noInvoices');
  }

  // ---- Form actions ----

  startCreate(): void {
    this.editingId.set(null);
    this.isCreating.set(true);
    this.fName.set('');
    this.fTaxId.set('');
    this.fEmail.set('');
    this.fPhone.set('');
    this.fAddress.set('');
    this.fNotes.set('');
  }

  startEdit(c: Customer): void {
    this.editingId.set(c.id);
    this.isCreating.set(true);
    this.fName.set(c.name);
    this.fTaxId.set(c.taxId ?? '');
    this.fEmail.set(c.email ?? '');
    this.fPhone.set(c.phone ?? '');
    this.fAddress.set(c.address ?? '');
    this.fNotes.set(c.notes ?? '');
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.isCreating.set(false);
  }

  async save(): Promise<void> {
    const name = this.fName().trim();
    if (!name) {
      this.toast.warn('catalogMgmt.nameRequired');
      return;
    }
    const input = {
      name,
      taxId: this.fTaxId().trim() || undefined,
      email: this.fEmail().trim() || undefined,
      phone: this.fPhone().trim() || undefined,
      address: this.fAddress().trim() || undefined,
      notes: this.fNotes().trim() || undefined,
    };
    const id = this.editingId();
    if (id) {
      await this.customersSvc.update(id, input);
    } else {
      await this.customersSvc.add(input);
    }
    this.toast.success('toast.customerSaved');
    this.cancelEdit();
  }

  async remove(c: Customer): Promise<void> {
    const msg = this.i18n.t('customers.deleteConfirm', { name: c.name });
    if (!await this.confirmSvc.confirm(msg, this.i18n.t('common.delete'))) return;
    // Two-phase removal: mark as leaving so the CSS exit animation plays,
    // then actually remove from the service after the animation duration.
    this.leavingCustomerIds.update((s) => new Set(s).add(c.id));
    window.setTimeout(async () => {
      await this.customersSvc.remove(c.id);
      this.leavingCustomerIds.update((s) => {
        const next = new Set(s);
        next.delete(c.id);
        return next;
      });
    }, 200);
    this.toast.info('toast.customerDeleted');
  }

  /** Copy customer fields onto the active invoice meta. */
  async useForInvoice(c: Customer): Promise<void> {
    await this.invoiceSvc.updateMeta({
      customerId: c.id,
      customerName: c.name,
      customerEmail: c.email,
      customerTaxId: c.taxId,
      customerAddress: c.address,
    });
    this.toast.success('toast.saved');
    void this.router.navigate(['/invoice']);
  }

  // ---- Saved-invoice actions ----

  /** Clone a saved invoice back into the active editor. */
  async cloneToEditor(inv: Invoice): Promise<void> {
    await this.invoiceSvc.loadSaved(inv);
    this.toast.success('toast.saved');
    void this.router.navigate(['/invoice']);
  }

  async deleteInvoice(inv: Invoice): Promise<void> {
    const msg = this.i18n.t('customers.deleteInvoiceConfirm', { number: inv.meta.invoiceNumber });
    if (!await this.confirmSvc.confirm(msg, this.i18n.t('common.delete'))) return;
    this.leavingInvoiceIds.update((s) => new Set(s).add(inv.id));
    window.setTimeout(async () => {
      await this.invoiceSvc.deleteSaved(inv.id);
      this.leavingInvoiceIds.update((s) => {
        const next = new Set(s);
        next.delete(inv.id);
        return next;
      });
    }, 200);
    this.toast.info('toast.deleted');
  }

  // ---- Form input helpers ----

  onInput(target: 'name' | 'taxId' | 'email' | 'phone' | 'address' | 'notes', event: Event): void {
    const v = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    switch (target) {
      case 'name':    this.fName.set(v); break;
      case 'taxId':   this.fTaxId.set(v); break;
      case 'email':   this.fEmail.set(v); break;
      case 'phone':   this.fPhone.set(v); break;
      case 'address': this.fAddress.set(v); break;
      case 'notes':   this.fNotes.set(v); break;
    }
  }

  formatDate(iso: number): string {
    return new Date(iso).toLocaleDateString();
  }
}
