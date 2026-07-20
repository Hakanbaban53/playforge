import { Injectable, inject } from '@angular/core';
import { Invoice, lineTotal } from '../models/invoice.model';
import { LayoutElement } from '../models/receipt.model';
import { I18nService } from './i18n.service';
import {
  computeTextStyles,
  computeImageStyles,
  computeImageWrapperStyles,
  parseImageSources,
  computeTaxAmount,
} from '../utils/receipt-utils';

/**
 * Builds a self-contained HTML document for the receipt, suitable for
 * client-side PDF rendering via html2canvas + jsPDF.
 *
 * The HTML includes:
 *   - Inline `<style>` block with all receipt CSS (no external stylesheets).
 *   - The active invoice data (customer, items, totals, taxes, notes).
 *   - The user's customized layout (drag-drop order, visibility, styles).
 *   - Translated labels via `I18nService` so the PDF matches the app language
 *     (e.g. Turkish exports use Turkish headings, column names, etc.).
 *
 * Images are referenced by URL (e.g. `idb://...`) — the PDF service
 * resolves them to blob: URLs and then inlines as data: URIs before
 * html2canvas runs.
 */
@Injectable({ providedIn: 'root' })
export class ReceiptHtmlBuilder {
  private readonly i18n = inject(I18nService);

  build(invoice: Invoice, layout: LayoutElement[], baseUrl = ''): string {
    const meta = invoice.meta;
    const visibleElements = layout.filter((el) => el.visible);
    const body = visibleElements.map((el) => this.renderElement(el, invoice)).join('\n');
    const lang = this.i18n.lang();

    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <base href="${baseUrl}/" />
  <title>${this.escape(meta.invoiceNumber)} — Receipt</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
      color: #111827;
      margin: 0;
      padding: 32px 36px;
      font-size: 12px;
      line-height: 1.45;
    }
    .sheet { width: 100%; max-width: 540pt; margin: 0 auto; }
    .r-block { margin-bottom: 16px; break-inside: avoid; page-break-inside: avoid; }
    .r-header pre, .r-text pre, .r-notes pre { font-family: inherit; margin: 0; white-space: pre-wrap; line-height: 1.4; }
    .r-notes { border-top: 1px dashed #e6ebef; padding-top: 10px; margin-top: 4px; }
    .r-notes__placeholder { color: #9aa6af; font-style: italic; }
    .r-meta { font-size: 11px; color: #6b7782; }
    .r-meta__heading { font-size: 22px; font-weight: 700; color: #0f6638; margin-bottom: 4px; text-align: right; }
    .r-meta__num { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #4b5560; text-align: right; }
    .r-meta__date { margin-top: 2px; text-align: right; }
    .r-row__discount { display: inline-block; font-size: 9px; font-weight: 700; color: #b45309; background: #fef3c7; border-radius: 999px; padding: 1px 6px; margin-left: 6px; vertical-align: middle; }
    .r-billto { background: #f8fafb; border-radius: 4px; padding: 10px 12px; margin-bottom: 14px; }
    .r-billto__label { font-size: 9px; text-transform: uppercase; color: #6b7782; }
    .r-billto__name { font-weight: 700; font-size: 13px; margin-top: 2px; }
    .r-billto__line { font-size: 11px; color: #4b5560; margin-top: 1px; }
    .r-billto__addr { font-family: inherit; font-size: 11px; margin: 4px 0 0; white-space: pre-wrap; color: #6b7782; }
    .r-table { width: 100%; border-collapse: collapse; break-inside: avoid; page-break-inside: avoid; table-layout: fixed; }
    .r-table th, .r-table td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; text-align: left; font-size: 11px; vertical-align: top; word-wrap: break-word; overflow-wrap: anywhere; }
    .r-table th { font-size: 9px; text-transform: uppercase; color: #6b7782; background: #f8fafb; }
    .r-table__num { text-align: right; }
    .r-table__qty { width: 10%; }
    .r-table__price { width: 18%; }
    .r-table__total { width: 18%; }
    .r-row__cell { display: flex; gap: 10px; align-items: flex-start; }
    .r-row__img { width: 48px; height: 48px; object-fit: cover; border-radius: 4px; flex-shrink: 0; background: #f1f5f7; }
    .r-row__name { font-weight: 600; font-size: 11px; }
    .r-row__code { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #6b7782; margin-top: 1px; }
    .r-row__size { font-size: 10px; color: #6b7782; margin-top: 1px; }
    .r-row__parts { font-size: 9px; color: #9aa6af; margin-top: 4px; line-height: 1.4; }
    .r-empty { text-align: center; color: #9aa6af; padding: 24px; }
    .r-image { break-inside: avoid; page-break-inside: avoid; }
    .r-visuals { display: grid; gap: 10px; break-inside: avoid; page-break-inside: avoid; }
    .r-divider { border: none; border-top: 1px solid #e6ebef; margin: 14px 0; }
    .r-totals { margin-left: auto; width: 280px; margin-top: 16px; }
    .r-totals__row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px; color: #4b5560; }
    .r-totals__row--grand { border-top: 2px solid #d2dade; margin-top: 6px; padding-top: 8px; font-size: 13px; font-weight: 700; color: #111827; }
    @media (max-width: 768px) {
      body { padding: 20px 16px; font-size: 11px; }
      .r-totals { width: 100%; }
      .r-table th, .r-table td { padding: 6px 4px; font-size: 10px; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    ${body}
  </div>
</body>
</html>`;
  }

  private renderElement(el: LayoutElement, invoice: Invoice): string {
    switch (el.type) {
      case 'header': return this.renderHeader(el, invoice);
      case 'meta': return this.renderMeta(el, invoice);
      case 'table': return this.renderTable(el, invoice);
      case 'text': return this.renderText(el);
      case 'notes': return this.renderNotes(el, invoice);
      case 'image': return this.renderImage(el);
      case 'divider': return '<hr class="r-divider" />';
      case 'visuals': return this.renderVisuals(el, invoice);
      case 'totals': return this.renderTotals(el, invoice);
      default: return '';
    }
  }

  private renderHeader(el: LayoutElement, invoice: Invoice): string {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const content = el.content || invoice.meta.seller;
    const style = this.styleToString(computeTextStyles(el));
    return `<div class="r-block r-header" style="${style}"><pre>${this.escape(content)}</pre></div>`;
  }

  private renderMeta(el: LayoutElement, invoice: Invoice): string {
    const meta = invoice.meta;
    const headingKey = meta.docType === 'quote' ? 'quote.quoteHeading' : 'quote.invoiceHeading';
    const heading = this.i18n.t(headingKey);
    const issuedLabel = this.i18n.t('invoice.issued');
    const dueLabel = this.i18n.t('invoice.due');
    const billToLabel = this.i18n.t('invoice.billTo');
    const taxIdLabel = this.i18n.t('invoice.taxId');
    return `<div class="r-block r-meta">
      <div class="r-meta__heading">${this.escape(heading)}</div>
      <div class="r-meta__num">${this.escape(meta.invoiceNumber)}</div>
      <div class="r-meta__date">${this.escape(issuedLabel)} ${this.escape(meta.issueDate)}</div>
      ${meta.dueDate ? `<div class="r-meta__date">${this.escape(dueLabel)} ${this.escape(meta.dueDate)}</div>` : ''}
      <div class="r-billto">
        <div class="r-billto__label">${this.escape(billToLabel)}</div>
        <div class="r-billto__name">${this.escape(meta.customerName || '—')}</div>
        ${meta.customerEmail ? `<div class="r-billto__line">${this.escape(meta.customerEmail)}</div>` : ''}
        ${meta.customerTaxId ? `<div class="r-billto__line">${this.escape(taxIdLabel)}: ${this.escape(meta.customerTaxId)}</div>` : ''}
        ${meta.customerAddress ? `<pre class="r-billto__addr">${this.escape(meta.customerAddress)}</pre>` : ''}
      </div>
    </div>`;
  }

  private renderTable(el: LayoutElement, invoice: Invoice): string {
    const itemLabel = this.i18n.t('invoice.item');
    const qtyLabel = this.i18n.t('common.quantity');
    const unitLabel = this.i18n.t('invoice.unitPrice');
    const totalLabel = this.i18n.t('common.total');
    const emptyMsg = this.i18n.t('invoice.noLineItems');
    const sizeLabel = this.i18n.t('invoice.size');
    const partsTpl = this.i18n.t('invoice.partsLine');

    if (invoice.lines.length === 0) {
      return `<table class="r-table"><tbody><tr><td class="r-empty">${this.escape(emptyMsg)}</td></tr></tbody></table>`;
    }
    const rows = invoice.lines.map((line) => {
      const img = line.imageUrl
        ? `<img src="${this.escape(line.imageUrl)}" alt="" class="r-row__img" />`
        : '';
      const parts = line.parts.length > 0
        ? `<div class="r-row__parts">${this.escape(partsTpl.replace('{{count}}', String(line.parts.length)).replace('{{names}}', line.parts.map((p) => p.name).join(', ')))}</div>`
        : '';
      const size = line.size ? `<div class="r-row__size">${this.escape(sizeLabel)} ${this.escape(line.size)}</div>` : '';
      const discountPill = line.discount && line.discount.value > 0
        ? `<span class="r-row__discount">−${line.discount.type === 'percent' ? line.discount.value + '%' : this.fmt(line.discount.value, invoice.meta.currency)}</span>`
        : '';
      // `lineTotal` already applies the discount (see invoice.model.ts).
      const total = lineTotal(line);
      return `<tr>
        <td>
          <div class="r-row__cell">
            ${img}
            <div>
              <div class="r-row__name">${this.escape(line.name)} ${discountPill}</div>
              <div class="r-row__code">${this.escape(line.code)}</div>
              ${size}
              ${parts}
            </div>
          </div>
        </td>
        <td class="r-table__num">${line.quantity}</td>
        <td class="r-table__num">${this.fmt(line.unitPrice, invoice.meta.currency)}</td>
        <td class="r-table__num">${this.fmt(total, invoice.meta.currency)}</td>
      </tr>`;
    }).join('');
    return `<table class="r-table">
      <thead><tr>
        <th>${this.escape(itemLabel)}</th><th class="r-table__num r-table__qty">${this.escape(qtyLabel)}</th><th class="r-table__num r-table__price">${this.escape(unitLabel)}</th><th class="r-table__num r-table__total">${this.escape(totalLabel)}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  private renderText(el: LayoutElement): string {
    const style = this.styleToString(computeTextStyles(el));
    return `<div class="r-block r-text" style="${style}"><pre>${this.escape(el.content ?? '')}</pre></div>`;
  }

  private renderNotes(el: LayoutElement, invoice: Invoice): string {
    const style = this.styleToString(computeTextStyles(el));
    const notes = invoice.meta.notes?.trim() ?? '';
    if (notes) {
      return `<div class="r-block r-text r-notes" style="${style}"><pre>${this.escape(notes)}</pre></div>`;
    }
    const placeholder = this.i18n.t('invoice.notesPlaceholder');
    return `<div class="r-block r-text r-notes" style="${style}"><pre class="r-notes__placeholder">${this.escape(placeholder)}</pre></div>`;
  }

  private renderImage(el: LayoutElement): string {
    const sources = parseImageSources(el.content);
    if (sources.length === 0) return '';
    const imgStyle = this.styleToString(computeImageStyles(el));
    const wrapperStyle = this.styleToString(computeImageWrapperStyles(el));
    const imgs = sources.map((src) => `<img src="${this.escape(src)}" style="${imgStyle}" alt="" />`).join('');
    return `<div class="r-block r-image" style="${wrapperStyle}">${imgs}</div>`;
  }

  private renderVisuals(el: LayoutElement, invoice: Invoice): string {
    const urls = invoice.lines.map((l) => l.imageUrl).filter((u): u is string => !!u);
    if (urls.length === 0) return '';
    const imgStyle = this.styleToString(computeImageStyles(el));
    const wrapperStyle = this.styleToString(computeImageWrapperStyles(el));
    const imgs = urls.map((src) => `<img src="${this.escape(src)}" style="${imgStyle}" alt="" />`).join('');
    return `<div class="r-block r-visuals" style="${wrapperStyle}">${imgs}</div>`;
  }

  private renderTotals(el: LayoutElement, invoice: Invoice): string {
    const meta = invoice.meta;
    const subtotalLabel = this.i18n.t('invoice.subtotal');
    const totalLabel = this.i18n.t('invoice.grandTotal');
    // `lineTotal` applies per-line discounts (see invoice.model.ts).
    const subtotal = invoice.lines.reduce((sum, l) => sum + lineTotal(l), 0);
    const activeTaxes = meta.taxes.filter((t) => t.enabled && t.value !== 0);
    const taxRows = activeTaxes.map((tax) => {
      const amount = computeTaxAmount(tax, subtotal);
      const label = tax.type === 'percent' ? `${this.escape(tax.name)} (${tax.value}%)` : this.escape(tax.name);
      return `<div class="r-totals__row"><span>${label}</span><span>${this.fmt(amount, meta.currency)}</span></div>`;
    }).join('');
    const totalTax = activeTaxes.reduce((sum, t) => sum + computeTaxAmount(t, subtotal), 0);
    const grand = subtotal + totalTax;
    return `<div class="r-block">
      <div class="r-totals">
        <div class="r-totals__row"><span>${this.escape(subtotalLabel)}</span><span>${this.fmt(subtotal, meta.currency)}</span></div>
        ${taxRows}
        <div class="r-totals__row r-totals__row--grand"><span>${this.escape(totalLabel)}</span><span>${this.fmt(grand, meta.currency)}</span></div>
      </div>
    </div>`;
  }

  private styleToString(styles: Record<string, string>): string {
    return Object.entries(styles).map(([k, v]) => `${this.camelToKebab(k)}:${v}`).join(';');
  }

  private camelToKebab(str: string): string {
    return str.replace(/([A-Z])/g, '-$1').toLowerCase();
  }

  private fmt(amount: number, currency: string): string {
    try {
      return new Intl.NumberFormat(this.i18n.locale(), {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${currency} ${amount.toFixed(2)}`;
    }
  }

  private escape(s: string | undefined | null): string {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
}
