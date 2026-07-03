import { Component, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ExportService, ExportFormat } from '../../core/services/export.service';
import { CatalogService } from '../../core/services/catalog.service';
import { InvoiceService } from '../../core/services/invoice.service';
import { IconComponent } from '../../shared/components/icon.component';
import { ButtonComponent } from '../../shared/components/button.component';

/**
 * Export page — generate XLSX or CSV files for the catalog and saved
 * invoices.
 *
 * Catalog export supports family selection: the user can check/uncheck
 * individual families before exporting. This lets them export a subset
 * (e.g. only "slides") rather than the entire catalog.
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

  readonly families = this.catalog.families;
  readonly variantCount = this.catalog.variants().length;
  readonly savedInvoiceCount = this.invoiceService.listSaved().length;
  readonly activeLineCount = this.invoiceService.active().lines.length;

  /** Selected family codes for export. Empty = export all. */
  readonly selectedCodes = signal<Set<string>>(new Set());
  readonly selectAllFamilies = signal(true);

  /** How many families will be exported. */
  readonly exportCount = computed(() => {
    if (this.selectAllFamilies()) return this.families().length;
    return this.selectedCodes().size;
  });

  readonly lastExport = signal<string | null>(null);
  readonly error = signal<string | null>(null);

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
    this.error.set(null);
    try {
      const codes = this.selectAllFamilies()
        ? null
        : Array.from(this.selectedCodes());
      if (codes !== null && codes.length === 0) {
        this.error.set('No families selected.');
        return;
      }
      const blob = this.exportService.exportCatalogFiltered(format, codes);
      const ext = format === 'xlsx' ? 'xlsx' : 'csv';
      const name = `catalog-${new Date().toISOString().slice(0, 10)}.${ext}`;
      this.exportService.triggerDownload(blob, name);
      this.lastExport.set(`catalog.${format} → ${name} (${blob.size} bytes)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed.';
      this.error.set(msg);
    }
  }

  doInvoiceExport(format: ExportFormat): void {
    this.error.set(null);
    try {
      const blob = this.exportService.exportInvoices(format);
      const ext = format === 'xlsx' ? 'xlsx' : 'csv';
      const name = `invoices-${new Date().toISOString().slice(0, 10)}.${ext}`;
      this.exportService.triggerDownload(blob, name);
      this.lastExport.set(`invoices.${format} → ${name} (${blob.size} bytes)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed.';
      this.error.set(msg);
    }
  }
}
