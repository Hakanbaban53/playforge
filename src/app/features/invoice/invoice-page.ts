import {
  Component,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { InvoiceService } from '../../core/services/invoice.service';
import { PdfService } from '../../core/services/pdf.service';
import { ReceiptLayoutService } from '../../core/services/receipt-layout.service';
import { lineTotal } from '../../core/models/invoice.model';
import { IconComponent } from '../../shared/components/icon.component';
import { ButtonComponent } from '../../shared/components/button.component';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { ResolvedImgComponent } from '../../shared/components/resolved-img.component';
import { ReceiptPreviewComponent } from '../../shared/components/receipt-preview.component';
import { computeTaxAmount } from '../../core/utils/receipt-utils';

/**
 * Invoice builder + PDF export.
 *
 * The live preview uses `ReceiptPreviewComponent` — the SAME component the
 * receipt editor uses. This means any layout changes made in the receipt
 * editor (reorder, hide elements, add custom text/images, change styles)
 * are immediately visible in this page's preview too.
 *
 * PDF generation is client-side: `PdfService.downloadPdf()` builds a
 * self-contained HTML document from the same invoice + layout via
 * `ReceiptHtmlBuilder`, then renders it with jsPDF + html2canvas.
 */
@Component({
  selector: 'app-invoice-page',
  standalone: true,
  imports: [IconComponent, ButtonComponent, MoneyPipe, TranslatePipe, ResolvedImgComponent, ReceiptPreviewComponent],
  templateUrl: './invoice-page.html',
  styleUrl: './invoice-page.scss',
})
export class InvoicePage {
  private readonly invoiceService = inject(InvoiceService);
  private readonly pdf = inject(PdfService);
  private readonly router = inject(Router);
  private readonly receiptLayout = inject(ReceiptLayoutService);

  readonly active = this.invoiceService.active;
  readonly subtotal = this.invoiceService.subtotal;
  readonly activeTaxes = this.invoiceService.activeTaxes;
  readonly totalTax = this.invoiceService.totalTax;
  readonly grandTotal = this.invoiceService.grandTotal;
  readonly layout = this.receiptLayout.layout;

  readonly isGeneratingPdf = signal(false);
  readonly pdfError = signal<string | null>(null);
  readonly lastPageCount = signal<number | null>(null);

  /** Per-line total helper. */
  lineTotal = lineTotal;

  /** Tax amount for a single tax line. */
  taxAmount(tax: { type: 'percent' | 'fixed'; value: number }): number {
    return computeTaxAmount(tax, this.subtotal());
  }

  /** Navigate to the receipt layout editor. */
  openReceiptEditor(): void {
    void this.router.navigate(['/receipt-editor']);
  }

  /** Filter layout to visible items only (used by the renderer). */
  visibleLayout() {
    return this.layout().filter((el) => el.visible);
  }

  // ---------------------------------------------------------------------------
  // Meta + line mutations
  // ---------------------------------------------------------------------------

  updateMeta(event: Event, key: 'customerName' | 'customerEmail' | 'customerAddress' | 'customerTaxId' | 'invoiceNumber' | 'issueDate' | 'dueDate' | 'seller' | 'notes' | 'currency' | 'paperSize'): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
    this.invoiceService.updateMeta({ [key]: value } as never);
  }

  updateLineQty(lineId: string, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.invoiceService.updateLineQuantity(lineId, value);
  }

  removeLine(lineId: string): void {
    this.invoiceService.removeLine(lineId);
  }

  clearAll(): void {
    this.invoiceService.clearLines();
  }

  toggleTax(taxId: string, enabled: boolean): void {
    this.invoiceService.updateTax(taxId, { enabled });
  }

  updateTaxValue(taxId: string, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.invoiceService.updateTax(taxId, { value: Number.isFinite(value) ? value : 0 });
  }

  updateTaxName(taxId: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.invoiceService.updateTax(taxId, { name: value });
  }

  updateTaxType(taxId: string, event: Event): void {
    const value = (event.target as HTMLSelectElement).value as 'percent' | 'fixed';
    this.invoiceService.updateTax(taxId, { type: value });
  }

  addTax(): void {
    this.invoiceService.addTax();
  }

  removeTax(taxId: string): void {
    this.invoiceService.removeTax(taxId);
  }

  save(): void {
    this.invoiceService.saveAndReset();
  }

  // ---------------------------------------------------------------------------
  // PDF export
  // ---------------------------------------------------------------------------

  async downloadPdf(): Promise<void> {
    this.isGeneratingPdf.set(true);
    this.pdfError.set(null);
    this.lastPageCount.set(null);
    try {
      const meta = this.active().meta;
      const fileName = meta.invoiceNumber || 'invoice';
      const pageCount = await this.pdf.downloadPdf(fileName);
      this.lastPageCount.set(pageCount);
    } catch (err) {
      console.error('PDF generation failed:', err);
      this.pdfError.set(
        err instanceof Error ? err.message : 'Failed to generate PDF.',
      );
    } finally {
      this.isGeneratingPdf.set(false);
    }
  }
}
