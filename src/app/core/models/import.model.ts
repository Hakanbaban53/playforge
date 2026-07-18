/**
 * Excel import / template domain model.
 *
 * The downloadable template is a single workbook with two sheets:
 *   1. `Products`  — one row per product family/variant, with column-driven
 *                    parts (semicolon-separated) and image URLs.
 *   2. `Reference` — read-only lookup tables (categories, units, currency)
 *                    so non-technical users can fill the template correctly.
 *
 * The importer parses `Products` rows into a normalized list of
 * `ImportedProductDraft`s, then validates each row and reports a list of
 * `ImportRowError`s back to the UI.
 *
 * Localization
 * ------------
 * Column-key identity is the i18n key (`importColumns.familyCode`, etc).
 * When generating a template, the key is translated into the active
 * language and used as the header cell. When parsing, the parser builds a
 * reverse map of translated-header → key for every supported language, so a
 * template uploaded in Turkish is correctly parsed when the UI is in
 * English (and vice versa).
 */

export interface ImportedProductDraft {
  /** Row number in the spreadsheet (1-indexed, header row excluded). */
  rowIndex: number;
  familyCode: string;
  familyName: string;
  category: string;
  /** Variant label, e.g. "5m". Optional — defaults to "Standard". */
  variantLabel?: string;
  variantSku: string;
  size?: string;
  price: number;
  currency: string;
  ageRange?: string;
  description?: string;
  tags: string[];
  /**
   * Parts encoded as `name|sku|category|price[;name|sku|category|price]`.
   * We use `|` inside a part and `;` between parts to avoid CSV escaping.
   */
  partsRaw: string;
  /** Image URLs separated by `;`. First one is primary. */
  imagesRaw: string;
}

export type ImportErrorSeverity = 'error' | 'warning';

export interface ImportRowError {
  rowIndex: number;
  /** Column i18n key (e.g. 'importColumns.familyCode') — translated for display. */
  columnKey: string;
  /** Optional raw column label as found in the uploaded header. */
  columnLabel?: string;
  severity: ImportErrorSeverity;
  /** Error message i18n key — translated for display. */
  messageKey: string;
  /** Interpolation params for the message key. */
  messageParams?: Record<string, string | number>;
}

export interface ImportValidationResult {
  /** Drafts that passed all `error`-severity checks. */
  valid: ImportedProductDraft[];
  invalid: ImportedProductDraft[];
  errors: ImportRowError[];
  warnings: ImportRowError[];
  totalRows: number;
}

/** What will happen to a draft when imported (merge mode). */
export type ImportAction = 'create-family' | 'update-family' | 'create-variant' | 'update-variant' | 'create-customer' | 'update-customer';

/** Per-draft preview: what action will be taken and any conflicts. */
export interface ImportPreviewRow {
  draft: ImportedProductDraft | ImportedCustomerDraft;
  action: ImportAction;
  selected: boolean;
  conflicts: string[];
}

/** Full preview of what the import will do. */
export interface ImportPreview {
  rows: ImportPreviewRow[];
  newFamilies: number;
  updatedFamilies: number;
  newVariants: number;
  updatedVariants: number;
  newCustomers: number;
  updatedCustomers: number;
  conflicts: number;
}

/** Draft of a customer row parsed from the import workbook. */
export interface ImportedCustomerDraft {
  /** Row number in the spreadsheet (1-indexed, header row excluded). */
  rowIndex: number;
  name: string;
  taxId: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
}

/** Validation result for customer import. */
export interface CustomerImportValidationResult {
  valid: ImportedCustomerDraft[];
  invalid: ImportedCustomerDraft[];
  errors: ImportRowError[];
  warnings: ImportRowError[];
  totalRows: number;
}

/**
 * Column-key → i18n key map. The i18n key resolves to a translated header
 * label when generating or parsing the template. Single source of truth.
 */
export const TEMPLATE_COLUMNS = {
  familyCode: 'importColumns.familyCode',
  familyName: 'importColumns.familyName',
  category: 'importColumns.category',
  variantLabel: 'importColumns.variantLabel',
  variantSku: 'importColumns.variantSku',
  size: 'importColumns.size',
  price: 'importColumns.price',
  currency: 'importColumns.currency',
  ageRange: 'importColumns.ageRange',
  description: 'importColumns.description',
  tags: 'importColumns.tags',
  parts: 'importColumns.parts',
  images: 'importColumns.images',
} as const;

export type TemplateColumnKey = keyof typeof TEMPLATE_COLUMNS;

/** All supported languages — used to build the reverse-header map. */
export const SUPPORTED_LANGS = ['en', 'tr'] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

/**
 * Customer template column-key → i18n key map.
 * Same pattern as TEMPLATE_COLUMNS: the i18n key resolves to a translated
 * header when generating or parsing the customer template.
 */
export const CUSTOMER_TEMPLATE_COLUMNS = {
  name: 'importColumns.customerName',
  taxId: 'importColumns.customerTaxId',
  email: 'importColumns.customerEmail',
  phone: 'importColumns.customerPhone',
  address: 'importColumns.customerAddress',
  notes: 'importColumns.customerNotes',
} as const;

export type CustomerTemplateColumnKey = keyof typeof CUSTOMER_TEMPLATE_COLUMNS;
