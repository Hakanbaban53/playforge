import { Component, input, computed } from '@angular/core';
import { NgStyle } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { Invoice, lineTotal } from '../../core/models/invoice.model';
import { LayoutElement } from '../../core/models/receipt.model';
import { MoneyPipe } from '../pipes/money.pipe';
import { ResolvedImgComponent } from './resolved-img.component';
import {
  computeTextStyles,
  computeImageStyles,
  computeImageWrapperStyles,
  parseImageSources,
  computeTaxAmount,
} from '../../core/utils/receipt-utils';

/**
 * Shared receipt renderer with visual page breaks.
 *
 * The preview shows a dashed "page break" line at A4 page height intervals
 * (1080px at 96dpi) so the user can see where the PDF will split into pages.
 * Each element also has `break-inside: avoid` so no element is split.
 */
@Component({
  selector: 'app-receipt-preview',
  standalone: true,
  imports: [NgStyle, TranslatePipe, MoneyPipe, ResolvedImgComponent],
  template: `
    <div class="invoice-sheet" [class]="'sheet--' + paperSize().toLowerCase()">
      @for (el of visibleElements(); track el.id) {
        @switch (el.type) {
          @case ('header') {
            <div class="r-block r-header" [ngStyle]="textStyles(el)">
              <pre>{{ el.content || invoice().meta.seller }}</pre>
            </div>
          }
          @case ('meta') {
            <div class="r-block r-meta">
              <div class="r-meta__heading">
                {{ (invoice().meta.docType === 'quote' ? 'quote.quoteHeading' : 'quote.invoiceHeading') | translate }}
              </div>
              <div class="r-meta__num">{{ invoice().meta.invoiceNumber }}</div>
              <div class="r-meta__date">{{ 'invoice.issued' | translate }} {{ invoice().meta.issueDate }}</div>
              @if (invoice().meta.dueDate) {
                <div class="r-meta__date">{{ 'invoice.due' | translate }} {{ invoice().meta.dueDate }}</div>
              }
              <div class="r-billto">
                <div class="r-billto__label">{{ 'invoice.billTo' | translate }}</div>
                <div class="r-billto__name">{{ invoice().meta.customerName || '—' }}</div>
                @if (invoice().meta.customerEmail) {
                  <div class="r-billto__line">{{ invoice().meta.customerEmail }}</div>
                }
                @if (invoice().meta.customerTaxId) {
                  <div class="r-billto__line">{{ 'invoice.taxId' | translate }}: {{ invoice().meta.customerTaxId }}</div>
                }
                @if (invoice().meta.customerAddress) {
                  <pre class="r-billto__addr">{{ invoice().meta.customerAddress }}</pre>
                }
              </div>
            </div>
          }
          @case ('table') {
            <table class="r-table">
              <thead>
                <tr>
                  <th>{{ 'invoice.item' | translate }}</th>
                  <th class="r-table__num r-table__qty">{{ 'common.quantity' | translate }}</th>
                  <th class="r-table__num r-table__price">{{ 'invoice.unitPrice' | translate }}</th>
                  <th class="r-table__num r-table__total">{{ 'common.total' | translate }}</th>
                </tr>
              </thead>
              <tbody>
                @for (line of invoice().lines; track line.id) {
                  <tr>
                    <td>
                      <div class="r-cell">
                        @if (line.imageUrl) {
                          <app-resolved-img
                            [src]="line.imageUrl"
                            [alt]="line.name"
                            [styles]="{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '4px', flexShrink: '0', background: '#f1f5f7' }"
                          />
                        }
                        <div>
                          <div class="r-cell__name">
                            {{ line.name }}
                            @if (line.discount && line.discount.value > 0) {
                              <span class="r-cell__discount">−{{ line.discount.type === 'percent' ? line.discount.value + '%' : (line.discount.value | money: invoice().meta.currency) }}</span>
                            }
                          </div>
                          <div class="r-cell__code mono">{{ line.code }}</div>
                          @if (line.size) {
                            <div class="r-cell__size">{{ 'invoice.size' | translate }} {{ line.size }}</div>
                          }
                          @if (line.parts.length > 0) {
                            <div class="r-cell__parts">
                              {{ 'invoice.partsLine' | translate: { count: line.parts.length, names: line.parts.map(p => p.name).join(', ') } }}
                            </div>
                          }
                        </div>
                      </div>
                    </td>
                    <td class="r-table__num">{{ line.quantity }}</td>
                    <td class="r-table__num">{{ line.unitPrice | money: invoice().meta.currency }}</td>
                    <td class="r-table__num">{{ lineTotal(line) | money: invoice().meta.currency }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="4" class="r-empty">{{ 'invoice.noLineItems' | translate }}</td></tr>
                }
              </tbody>
            </table>
          }
          @case ('totals') {
            <div class="r-block">
              <div class="r-totals">
                <div class="r-totals__row">
                  <span>{{ 'invoice.subtotal' | translate }}</span>
                  <span class="mono">{{ subtotal() | money: invoice().meta.currency }}</span>
                </div>
                @for (tax of activeTaxes(); track tax.id) {
                  <div class="r-totals__row">
                    <span>{{ tax.name }} @if (tax.type === 'percent') { ({{ tax.value }}%) }</span>
                    <span class="mono">{{ taxAmount(tax) | money: invoice().meta.currency }}</span>
                  </div>
                }
                <div class="r-totals__row r-totals__row--grand">
                  <span>{{ 'invoice.grandTotal' | translate }}</span>
                  <span class="mono">{{ grandTotal() | money: invoice().meta.currency }}</span>
                </div>
              </div>
            </div>
          }
          @case ('text') {
            <div class="r-block r-text" [ngStyle]="textStyles(el)">
              <pre>{{ el.content }}</pre>
            </div>
          }
          @case ('notes') {
            <div class="r-block r-text r-notes" [ngStyle]="textStyles(el)">
              @if (invoice().meta.notes) {
                <pre>{{ invoice().meta.notes }}</pre>
              } @else {
                <pre class="r-notes__placeholder">{{ 'invoice.notesPlaceholder' | translate }}</pre>
              }
            </div>
          }
          @case ('image') {
            <div class="r-block r-image" [ngStyle]="imageWrapperStyles(el)">
              @for (src of imageSources(el); track src) {
                <app-resolved-img [src]="src" [styles]="imageStyles(el)" alt="" />
              }
            </div>
          }
          @case ('divider') {
            <hr class="r-divider" />
          }
          @case ('visuals') {
            <div class="r-block r-visuals" [ngStyle]="imageWrapperStyles(el)">
              @for (line of invoice().lines; track line.id) {
                @if (line.imageUrl) {
                  <app-resolved-img [src]="line.imageUrl" [alt]="line.name" [styles]="imageStyles(el)" />
                }
              }
            </div>
          }
        }
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      max-height: calc(100vh - 140px);
      min-height: 320px;
      overflow: auto;
      padding: 4px;

      @media (max-width: 1100px) {
        max-height: 70vh;
      }

      @media (max-width: 768px) {
        max-height: 60vh;
        min-height: 240px;
      }
    }

    .invoice-sheet {
      background: #ffffff;
      margin: 0 auto;
      padding: 32px;
      font-size: 12px;
      color: #1f242b;
      box-shadow: var(--shadow-md);
      border-radius: 4px;
      width: 540pt;
      min-width: 540pt;
    }

    .r-block {
      margin-bottom: 14px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .r-header pre, .r-text pre {
      font-family: inherit;
      margin: 0;
      white-space: pre-wrap;
      line-height: 1.4;
    }
    .r-notes {
      border-top: 1px dashed #e6ebef;
      padding-top: 10px;
      margin-top: 4px;
    }
    .r-notes__placeholder {
      color: #9aa6af;
      font-style: italic;
    }
    .r-meta {
      font-size: 11px;
      color: #6b7782;
    }
    .r-meta__heading { font-size: 22px; font-weight: 700; color: #0f6638; letter-spacing: 0.08em; margin-bottom: 4px; text-align: right; }
    .r-meta__num { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #4b5560; text-align: right; }
    .r-meta__date { margin-top: 2px; text-align: right; }
    .r-billto {
      background: #f8fafb;
      border-radius: 4px;
      padding: 10px 12px;
      margin-top: 10px;
    }
    .r-billto__label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7782; }
    .r-billto__name { font-weight: 700; font-size: 13px; margin-top: 2px; }
    .r-billto__line { font-size: 11px; color: #4b5560; margin-top: 1px; }
    .r-billto__addr { font-family: inherit; font-size: 11px; margin: 4px 0 0; white-space: pre-wrap; color: #6b7782; }

    .r-table { width: 100%; border-collapse: collapse; break-inside: avoid; page-break-inside: avoid; table-layout: fixed; }
    .r-table th, .r-table td { padding: 8px 10px; border-bottom: 1px solid #e6ebef; text-align: left; font-size: 11px; vertical-align: top; word-wrap: break-word; overflow-wrap: anywhere; }
    .r-table th { font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7782; background: #f8fafb; }
    .r-table__num { text-align: right; }
    .r-table__qty { width: 10%; }
    .r-table__price { width: 18%; }
    .r-table__total { width: 18%; }

    .r-cell { display: flex; gap: 10px; align-items: flex-start; }
    .r-cell__name { font-weight: 600; font-size: 11px; }
    .r-cell__discount { display: inline-block; font-size: 9px; font-weight: 700; color: #b45309; background: #fef3c7; border-radius: 999px; padding: 1px 6px; margin-left: 6px; vertical-align: middle; }
    .r-cell__code { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #6b7782; margin-top: 1px; }
    .r-cell__size { font-size: 10px; color: #6b7782; margin-top: 1px; }
    .r-cell__parts { font-size: 9px; color: #9aa6af; margin-top: 4px; line-height: 1.4; }

    .r-empty { text-align: center; color: #9aa6af; padding: 24px; }

    .r-image {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .r-visuals {
      display: grid;
      gap: 10px;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .r-divider {
      border: none;
      border-top: 1px solid #e6ebef;
      margin: 14px 0;
    }

    .r-totals {
      margin-left: auto;
      width: 280px;
      margin-top: 16px;
    }
    .r-totals__row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px; color: #4b5560; }
    .r-totals__row--grand {
      border-top: 2px solid #d2dade;
      margin-top: 6px;
      padding-top: 8px;
      font-size: 13px;
      font-weight: 700;
      color: #111827;
    }
  `],
})
export class ReceiptPreviewComponent {
  readonly invoice = input.required<Invoice>();
  readonly layout = input.required<LayoutElement[]>();
  readonly paperSize = input<string>('A4');

  readonly visibleElements = computed(() =>
    this.layout().filter((el) => el.visible),
  );

  readonly subtotal = computed(() =>
    this.invoice().lines.reduce((sum, l) => sum + lineTotal(l), 0),
  );

  readonly activeTaxes = computed(() =>
    this.invoice().meta.taxes.filter((t) => t.enabled && t.value !== 0),
  );

  readonly grandTotal = computed(() => {
    const sub = this.subtotal();
    const tax = this.activeTaxes().reduce((sum, t) => {
      if (t.type === 'fixed') return sum + t.value;
      return sum + sub * (t.value / 100);
    }, 0);
    return sub + tax;
  });

  lineTotal = lineTotal;

  taxAmount(tax: { type: 'percent' | 'fixed'; value: number }): number {
    return computeTaxAmount(tax, this.subtotal());
  }

  imageSources(el: LayoutElement): string[] {
    return parseImageSources(el.content);
  }

  textStyles(el: LayoutElement): Record<string, string> {
    return computeTextStyles(el);
  }

  imageStyles(el: LayoutElement): Record<string, string> {
    return computeImageStyles(el);
  }

  imageWrapperStyles(el: LayoutElement): Record<string, string> {
    return computeImageWrapperStyles(el);
  }
}
