import { Component, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ExportService, ExportFormat } from '../../core/services/export.service';
import { CatalogService } from '../../core/services/catalog.service';
import { InvoiceService } from '../../core/services/invoice.service';
import { CustomersService } from '../../core/services/customers.service';
import { FavoritesService } from '../../core/services/favorites.service';
import { ToastService } from '../../core/services/toast.service';
import { IconComponent } from '../../shared/components/icon.component';
import { ButtonComponent } from '../../shared/components/button.component';

/**
 * Export page — generate XLSX or CSV files for the catalog and saved
 * invoices.
 *
 * Catalog export supports family selection: the user can check/uncheck
 * individual families before exporting. This lets them export a subset
 * (e.g. only "slides") rather than the entire catalog.
 *
 * Feedback: success is reported via a transient toast (auto-dismiss) rather
 * than a persistent banner — the browser's download notification is the
 * primary confirmation, the toast is just a count summary. Errors also go
 * through the toast so they don't linger on the page after the user has
 * moved on.
 */
@Component({
  selector: 'app-export-page',
  standalone: true,
  imports: [IconComponent, ButtonComponent, TranslatePipe],
  templateUrl: './export-page.html',
  styleUrl: './export-page.scss',
})
export class ExportPage {
  private readonly exportService = inject(ExportService);
  private readonly catalog = inject(CatalogService);
  private readonly invoiceService = inject(InvoiceService);
  private readonly customersService = inject(CustomersService);
  private readonly favoritesService = inject(FavoritesService);
  private readonly toast = inject(ToastService);

  readonly families = this.catalog.families;
  readonly savedInvoiceCount = computed(() => this.invoiceService.listSaved().length);
  readonly activeLineCount = computed(() => this.invoiceService.active().lines.length);
  readonly customerCount = computed(() => this.customersService.customers().length);
  readonly favoritesCount = computed(() => this.favoritesService.count());

  /** Selected family codes for export. Empty = export all. */
  readonly selectedCodes = signal<Set<string>>(new Set());
  readonly selectAllFamilies = signal(true);

  /** How many families will be exported. */
  readonly exportCount = computed(() => {
    if (this.selectAllFamilies()) return this.families().length;
    return this.selectedCodes().size;
  });

  toggleFamily(code: string): void {
    this.selectAllFamilies.set(false);
    this.selectedCodes.update((set) => {
      const next = new Set(set);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  toggleSelectAll(): void {
    this.selectAllFamilies.update((v) => !v);
    if (this.selectAllFamilies()) {
      this.selectedCodes.set(new Set());
    }
  }

  isFamilySelected(code: string): boolean {
    if (this.selectAllFamilies()) return true;
    return this.selectedCodes().has(code);
  }

  doCatalogExport(format: ExportFormat): void {
    try {
      const codes = this.selectAllFamilies()
        ? null
        : Array.from(this.selectedCodes());
      if (codes !== null && codes.length === 0) {
        this.toast.warn('export.toastExportFailed');
        return;
      }
      const blob = this.exportService.exportCatalogFiltered(format, codes);
      const ext = format === 'xlsx' ? 'xlsx' : 'csv';
      const name = `catalog-${new Date().toISOString().slice(0, 10)}.${ext}`;
      this.exportService.triggerDownload(blob, name);
      this.toast.success('export.toastCatalogExported', { count: this.exportCount() });
    } catch (err) {
      console.error('Catalog export failed:', err);
      this.toast.error('export.toastExportFailed');
    }
  }

  doInvoiceExport(format: ExportFormat): void {
    try {
      const blob = this.exportService.exportInvoices(format);
      const ext = format === 'xlsx' ? 'xlsx' : 'csv';
      const name = `invoices-${new Date().toISOString().slice(0, 10)}.${ext}`;
      this.exportService.triggerDownload(blob, name);
      const rows = blob.size > 0 ? this.savedInvoiceCount() : 0;
      this.toast.success('export.toastInvoicesExported', { count: rows });
    } catch (err) {
      console.error('Invoice export failed:', err);
      this.toast.error('export.toastExportFailed');
    }
  }

  doCustomerExport(format: ExportFormat): void {
    try {
      const blob = this.exportService.exportCustomers(format);
      const ext = format === 'xlsx' ? 'xlsx' : 'csv';
      const name = `customers-${new Date().toISOString().slice(0, 10)}.${ext}`;
      this.exportService.triggerDownload(blob, name);
      this.toast.success('export.toastCustomersExported', { count: this.customerCount() });
    } catch (err) {
      console.error('Customer export failed:', err);
      this.toast.error('export.toastExportFailed');
    }
  }

  doSettingsExport(): void {
    try {
      const blob = this.exportService.exportAppSettings();
      const name = `playforge-settings-${new Date().toISOString().slice(0, 10)}.json`;
      this.exportService.triggerDownload(blob, name);
      this.toast.success('export.toastSettingsExported');
    } catch (err) {
      console.error('Settings export failed:', err);
      this.toast.error('export.toastExportFailed');
    }
  }

  /**
   * Download a JSON bundle with empty sections — gives users a skeleton
   * of the schema so they can hand-write a settings bundle without first
   * having to export real data. The template round-trips through the
   * import validator: every section is valid (just empty), so the user
   * can tick just the sections they filled in.
   */
  doSettingsTemplate(): void {
    try {
      const blob = this.exportService.exportAppSettingsTemplate();
      const name = 'playforge-settings-template.json';
      this.exportService.triggerDownload(blob, name);
      this.toast.success('export.toastTemplateExported');
    } catch (err) {
      console.error('Settings template failed:', err);
      this.toast.error('export.toastExportFailed');
    }
  }
}
