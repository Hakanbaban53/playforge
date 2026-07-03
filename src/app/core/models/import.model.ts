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
  /** Size override (free text). */
  size?: string;
  /** Unit price. */
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
  /** Drafts that have at least one error; kept for display. */
  invalid: ImportedProductDraft[];
  /** All errors across all rows. */
  errors: ImportRowError[];
  /** Warnings across all rows. */
  warnings: ImportRowError[];
  /** Total row count (valid + invalid). */
  totalRows: number;
}

/** What will happen to a draft when imported (merge mode). */
export type ImportAction = 'create-family' | 'update-family' | 'create-variant' | 'update-variant';

/** Per-draft preview: what action will be taken and any conflicts. */
export interface ImportPreviewRow {
  draft: ImportedProductDraft;
  action: ImportAction;
  /** True if the row is selected for import (user can toggle). */
  selected: boolean;
  /** Conflict warnings specific to this row. */
  conflicts: string[];
}

/** Full preview of what the import will do. */
export interface ImportPreview {
  rows: ImportPreviewRow[];
  newFamilies: number;
  updatedFamilies: number;
  newVariants: number;
  updatedVariants: number;
  conflicts: number;
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
