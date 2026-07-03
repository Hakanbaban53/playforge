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

export interface InvoiceMeta {
  invoiceNumber: string;
  issueDate: string; // ISO yyyy-mm-dd
  dueDate?: string;
  customerName: string;
  customerEmail?: string;
  customerAddress?: string;
  customerTaxId?: string;
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

/** Helper: total for a single line. */
export function lineTotal(line: InvoiceLine): number {
  return line.unitPrice * line.quantity;
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
