import { ConfiguredPart, ResolvedProduct } from './catalog.model';

/**
 * Invoice domain model.
 *
 * An invoice is built from configured products (either a resolved catalog
 * variant or a free-form configured assembly). Each line item retains the
 * part breakdown so the customer-facing PDF can show *why* the line costs
 * what it does — this is the headline feature of the configurator flow.
 */

export interface InvoiceLinePart {
  partId: string;
  name: string;
  sku: string;
  unitPrice: number;
  quantity: number;
}

export interface InvoiceLine {
  /** Stable id within the invoice. */
  id: string;
  /** Source variant SKU, if this line came from a catalog variant. */
  sourceVariantSku?: string;
  /** Source family id, if applicable. */
  familyId?: string;
  /** Display name on the invoice. */
  name: string;
  /** Marketing code shown alongside the name. */
  code: string;
  /** Resolved part breakdown — may be empty for one-piece products. */
  parts: InvoiceLinePart[];
  /** Per-unit price (sum of parts, or explicit override). */
  unitPrice: number;
  /** Number of assemblies on this line. */
  quantity: number;
  /** Optional per-line discount. When absent, no discount is applied. */
  discount?: LineDiscount;
  /** Primary image URL for the line (rendered on the PDF). */
  imageUrl?: string;
  /** Optional size label (e.g. "5m"). */
  size?: string;
}

export type TaxType = 'percent' | 'fixed';

export interface TaxLine {
  id: string;
  name: string;
  type: TaxType;
  /** Percent value (e.g. 20 for 20%) or fixed amount in invoice currency. */
  value: number;
  enabled: boolean;
}

export type PaperSize = 'A4' | 'A5' | 'Letter';

/** Document type — a quote is a proposal, an invoice is a bill. Both share
 *  the same shape; the distinction affects the document number prefix
 *  (`QUO-` vs `INV-`) and the heading shown on the PDF. */
export type DocType = 'quote' | 'invoice';

/** Per-line discount. `percent` subtracts N% of the line total; `fixed`
 *  subtracts a flat amount in the invoice currency. */
export type DiscountType = 'percent' | 'fixed';

export interface LineDiscount {
  type: DiscountType;
  /** For `percent`: 0-100. For `fixed`: a non-negative amount. */
  value: number;
}

export interface InvoiceMeta {
  invoiceNumber: string;
  /** Quote vs invoice — same shape, different prefix + heading. */
  docType: DocType;
  issueDate: string; // ISO yyyy-mm-dd
  dueDate?: string;
  customerName: string;
  customerEmail?: string;
  customerAddress?: string;
  customerTaxId?: string;
  /** Optional customer id from the customer book, if this invoice was
   *  created against a saved customer. */
  customerId?: string;
  /** Seller info block (multi-line). */
  seller: string;
  currency: string;
  paperSize: PaperSize;
  taxes: TaxLine[];
  /** Optional notes / terms printed at the bottom. */
  notes?: string;
}

export interface Invoice {
  id: string;
  meta: InvoiceMeta;
  lines: InvoiceLine[];
  createdAt: number;
  updatedAt: number;
}

/** Helper: total for a single line, applying any per-line discount. */
export function lineTotal(line: InvoiceLine): number {
  const gross = line.unitPrice * line.quantity;
  return applyDiscount(gross, line.discount);
}

/** Apply a discount (percent or fixed) to a gross amount. Returns the
 *  discounted amount, never negative. */
export function applyDiscount(amount: number, discount?: LineDiscount): number {
  if (!discount || discount.value === 0) return amount;
  if (discount.type === 'percent') {
    const pct = Math.max(0, Math.min(100, discount.value));
    return Math.max(0, amount - amount * (pct / 100));
  }
  // Fixed-amount discount — never goes below zero.
  return Math.max(0, amount - Math.max(0, discount.value));
}

/** Helper: build an InvoiceLine from a resolved catalog variant. */
export function lineFromResolved(
  resolved: ResolvedProduct,
  quantity: number,
): InvoiceLine {
  const primaryImage = resolved.images.find((i) => i.isPrimary) ?? resolved.images[0];
  return {
    id: crypto.randomUUID(),
    sourceVariantSku: resolved.sku,
    familyId: resolved.familyId,
    name: resolved.name,
    code: resolved.sku,
    parts: resolved.parts.map((p) => ({
      partId: p.id,
      name: p.name,
      sku: p.sku,
      unitPrice: p.price,
      quantity: 1,
    })),
    unitPrice: resolved.price,
    quantity,
    imageUrl: primaryImage?.url,
    size: resolved.size,
  };
}

/** Helper: build an InvoiceLine from a configured assembly. */
export function lineFromConfiguration(
  familyName: string,
  familyCode: string,
  familyId: string,
  parts: { partId: string; name: string; sku: string; unitPrice: number; quantity: number }[],
  imageUrl: string | undefined,
  size: string | undefined,
): InvoiceLine {
  const unitPrice = parts.reduce((sum, p) => sum + p.unitPrice * p.quantity, 0);
  return {
    id: crypto.randomUUID(),
    familyId,
    name: familyName,
    code: familyCode,
    parts: parts.map((p) => ({ ...p })),
    unitPrice,
    quantity: 1,
    imageUrl,
    size,
  };
}

/** Re-exported for ergonomic imports. */
export type { ConfiguredPart };
