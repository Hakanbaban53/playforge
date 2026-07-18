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
import { ToastService } from '../../core/services/toast.service';
import { lineTotal, InvoiceMeta } from '../../core/models/invoice.model';
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
  private readonly toast = inject(ToastService);

  readonly active = this.invoiceService.active;
  readonly subtotal = this.invoiceService.subtotal;
  readonly layout = this.receiptLayout.layout;

  readonly isGeneratingPdf = signal(false);
  readonly pdfError = signal<string | null>(null);
  readonly lastPageCount = signal<number | null>(null);

  /** IDs of line items / tax items currently playing their exit animation.
   *  The @for keeps them in the DOM until the animation finishes, then the
   *  underlying service actually removes them. */
  readonly leavingLineIds = signal<ReadonlySet<string>>(new Set());
  readonly leavingTaxIds = signal<ReadonlySet<string>>(new Set());

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

  // ---------------------------------------------------------------------------
  // Meta + line mutations
  // ---------------------------------------------------------------------------

  updateMeta(event: Event, key: keyof InvoiceMeta): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
    if (key === 'docType') {
      void this.invoiceService.setDocType(value as 'quote' | 'invoice');
      return;
    }
    void this.invoiceService.updateMeta({ [key]: value });
  }

  updateLineQty(lineId: string, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    void this.invoiceService.updateLineQuantity(lineId, value);
  }

  updateDiscountType(lineId: string, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'none') {
      void this.invoiceService.updateLineDiscount(lineId, undefined);
      return;
    }
    const line = this.active().lines.find((l) => l.id === lineId);
    const existing = line?.discount;
    void this.invoiceService.updateLineDiscount(lineId, {
      type: value as 'percent' | 'fixed',
      value: existing?.value ?? 0,
    });
  }

  updateDiscountValue(lineId: string, event: Event): void {
    const line = this.active().lines.find((l) => l.id === lineId);
    if (!line?.discount) return;
    const raw = Number((event.target as HTMLInputElement).value);
    const value = Number.isFinite(raw) && raw >= 0 ? raw : 0;
    void this.invoiceService.updateLineDiscount(lineId, {
      type: line.discount.type,
      value,
    });
  }

  removeLine(lineId: string): void {
    this.leavingLineIds.update((s) => new Set(s).add(lineId));
    window.setTimeout(() => {
      void this.invoiceService.removeLine(lineId);
      this.leavingLineIds.update((s) => {
        const next = new Set(s);
        next.delete(lineId);
        return next;
      });
    }, 180);
    this.toast.info('toast.lineRemoved');
  }

  clearAll(): void {
    void this.invoiceService.clearLines();
    this.toast.info('toast.linesCleared');
  }

  toggleTax(taxId: string, enabled: boolean): void {
    void this.invoiceService.updateTax(taxId, { enabled });
  }

  updateTaxValue(taxId: string, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    void this.invoiceService.updateTax(taxId, { value: Number.isFinite(value) ? value : 0 });
  }

  updateTaxName(taxId: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    void this.invoiceService.updateTax(taxId, { name: value });
  }

  updateTaxType(taxId: string, event: Event): void {
    const value = (event.target as HTMLSelectElement).value as 'percent' | 'fixed';
    void this.invoiceService.updateTax(taxId, { type: value });
  }

  addTax(): void {
    void this.invoiceService.addTax();
  }

  removeTax(taxId: string): void {
    this.leavingTaxIds.update((s) => new Set(s).add(taxId));
    window.setTimeout(() => {
      void this.invoiceService.removeTax(taxId);
      this.leavingTaxIds.update((s) => {
        const next = new Set(s);
        next.delete(taxId);
        return next;
      });
    }, 180);
  }

  async save(): Promise<void> {
    await this.invoiceService.saveAndReset();
    this.toast.success('toast.invoiceSaved');
  }

  async convertToInvoice(): Promise<void> {
    await this.invoiceService.convertToInvoice();
    this.toast.success('toast.convertedToInvoice');
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
      this.toast.success('toast.pdfGenerated', { count: pageCount });
    } catch (err) {
      console.error('PDF generation failed:', err);
      const msg = err instanceof Error ? err.message : 'Failed to generate PDF.';
      this.pdfError.set(msg);
      this.toast.error('toast.pdfFailed');
    } finally {
      this.isGeneratingPdf.set(false);
    }
  }
}
