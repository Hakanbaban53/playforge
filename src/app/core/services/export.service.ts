import { Injectable, inject } from '@angular/core';
import * as XLSX from 'xlsx';
import { CatalogService } from './catalog.service';
import { InvoiceService } from './invoice.service';
import { I18nService } from './i18n.service';
import { TEMPLATE_COLUMNS } from '../models/import.model';
import { ProductFamily, ProductVariant, Part } from '../models/catalog.model';
import { Invoice, InvoiceLine } from '../models/invoice.model';

export type ExportFormat = 'xlsx' | 'csv';
export type ExportDataset = 'catalog' | 'invoices';

/**
 * Export service — generates XLSX or CSV files for the catalog and saved
 * invoices. The catalog export uses the **same column structure as the
 * import template** so the round-trip (export → edit → re-import) works
 * cleanly.
 *
 * Two datasets:
 *
 *   1. **Catalog** — one row per (family × variant), with parts encoded as
 *      `name|sku|category|price; ...` and images as `url; url; ...`. This
 *      matches the import format exactly.
 *
 *   2. **Invoices** — one row per line item across all saved invoices plus
 *      the active one. Columns: invoice number, issue date, customer, line
 *      item code, name, quantity, unit price, line total, currency.
 *
 * Files are returned as Blobs ready for download.
 */
@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly catalog = inject(CatalogService);
  private readonly invoiceService = inject(InvoiceService);
  private readonly i18n = inject(I18nService);

  /**
   * Export the catalog (families + variants + parts) as a workbook with
   * the same column structure as the import template.
   */
  exportCatalog(format: ExportFormat): Blob {
    const headers = this.translatedHeaders();
    const rows = this.buildCatalogRows();

    return format === 'csv'
      ? this.toCsvBlob([headers, ...rows])
      : this.toXlsxBlob([headers, ...rows], this.i18n.t('import.productsSheet'));
  }

  /**
   * Export only the specified families (by family code) as a workbook/CSV.
   * If `familyCodes` is null, exports all families (same as `exportCatalog`).
   */
  exportCatalogFiltered(format: ExportFormat, familyCodes: string[] | null): Blob {
    const headers = this.translatedHeaders();
    const allRows = this.buildCatalogRows();
    const rows = familyCodes
      ? allRows.filter((row) => familyCodes.includes(String(row[0])))
      : allRows;
    return format === 'csv'
      ? this.toCsvBlob([headers, ...rows])
      : this.toXlsxBlob([headers, ...rows], this.i18n.t('import.productsSheet'));
  }

  /**
   * Export all saved invoices (plus the active one) as a workbook with one
   * row per line item.
   */
  exportInvoices(format: ExportFormat): Blob {
    const headers = this.invoiceHeaders();
    const rows = this.buildInvoiceRows();
    return format === 'csv'
      ? this.toCsvBlob([headers, ...rows])
      : this.toXlsxBlob([headers, ...rows], this.i18n.t('invoice.title'));
  }

  triggerDownload(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // ---- Catalog rows ----

  private buildCatalogRows(): (string | number)[][] {
    const families = this.catalog.families();
    const variantsByFamily = this.catalog.variantsByFamily();
    const rows: (string | number)[][] = [];

    for (const family of families) {
      const variants = variantsByFamily.get(family.id) ?? [this.placeholderVariant(family)];
      for (const variant of variants) {
        const parts = this.resolveParts(family, variant);
        const images = this.resolveImages(family, variant);
        const overrides = new Map(variant.overrides.map((o) => [o.key, o]));
        const sizeOv = overrides.get('size');
        const priceOv = overrides.get('price');

        rows.push([
          family.code,
          family.name,
          family.category,
          variant.label,
          variant.sku,
          sizeOv && sizeOv.key === 'size' ? sizeOv.value : '',
          priceOv && priceOv.key === 'price' ? priceOv.value : 0,
          family.currency,
          family.ageRange ?? '',
          family.description,
          family.tags.join(', '),
          this.encodeParts(parts),
          this.encodeImages(images),
        ]);
      }
    }
    return rows;
  }

  private placeholderVariant(family: ProductFamily): ProductVariant {
    return {
      id: `placeholder-${family.id}`,
      familyId: family.id,
      label: 'Standard',
      sku: `${family.code}-STD`,
      active: true,
      overrides: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private resolveParts(family: ProductFamily, variant: ProductVariant): Part[] {
    const partsOv = variant.overrides.find((o) => o.key === 'parts');
    if (partsOv && partsOv.key === 'parts') {
      const byId = new Map(family.availableParts.map((p) => [p.id, p]));
      return partsOv.value.map((id) => byId.get(id)).filter((p): p is Part => p != null);
    }
    return family.availableParts;
  }

  private resolveImages(family: ProductFamily, variant: ProductVariant): string[] {
    const imgOv = variant.overrides.find((o) => o.key === 'images');
    if (imgOv && imgOv.key === 'images') {
      return imgOv.value.map((i) => i.url);
    }
    return family.images.map((i) => i.url);
  }

  private encodeParts(parts: Part[]): string {
    return parts
      .map((p) => `${p.name}|${p.sku}|${p.category}|${p.price}`)
      .join('; ');
  }

  private encodeImages(urls: string[]): string {
    return urls.join('; ');
  }

  /** Translate every column header into the active language. */
  private translatedHeaders(): string[] {
    return (Object.keys(TEMPLATE_COLUMNS) as (keyof typeof TEMPLATE_COLUMNS)[]).map(
      (key) => this.i18n.t(TEMPLATE_COLUMNS[key]),
    );
  }

  // ---- Invoice rows ----

  private invoiceHeaders(): string[] {
    return [
      'Invoice Number',
      'Issue Date',
      'Due Date',
      'Customer Name',
      'Customer Email',
      'Customer Tax ID',
      'Line Code',
      'Line Name',
      'Quantity',
      'Unit Price',
      'Line Total',
      'Currency',
      'Paper Size',
    ];
  }

  private buildInvoiceRows(): (string | number)[][] {
    const saved = this.invoiceService.listSaved();
    const active = this.invoiceService.active();
    const all = [...saved];
    if (active.lines.length > 0) all.push(active);

    const rows: (string | number)[][] = [];
    for (const inv of all) {
      for (const line of inv.lines) {
        rows.push(this.invoiceRow(inv, line));
      }
    }
    return rows;
  }

  private invoiceRow(inv: Invoice, line: InvoiceLine): (string | number)[] {
    return [
      inv.meta.invoiceNumber,
      inv.meta.issueDate,
      inv.meta.dueDate ?? '',
      inv.meta.customerName,
      inv.meta.customerEmail ?? '',
      inv.meta.customerTaxId ?? '',
      line.code,
      line.name,
      line.quantity,
      line.unitPrice,
      line.unitPrice * line.quantity,
      inv.meta.currency,
      inv.meta.paperSize,
    ];
  }

  // ---- Blob converters ----

  private toXlsxBlob(rows: (string | number)[][], sheetName: string): Blob {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = rows[0].map((_, i) => {
      const maxLen = Math.max(...rows.map((r) => String(r[i] ?? '').length));
      return { wch: Math.min(60, Math.max(12, maxLen + 2)) };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31) || 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    return new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  private toCsvBlob(rows: (string | number)[][]): Blob {
    const escape = (v: string | number): string => {
      const s = String(v ?? '');
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const text = rows.map((r) => r.map(escape).join(',')).join('\r\n');
    // Prepend BOM so Excel opens UTF-8 correctly.
    return new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' });
  }
}
