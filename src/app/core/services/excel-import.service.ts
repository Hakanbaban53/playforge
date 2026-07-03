import { Injectable, inject } from '@angular/core';
import * as XLSX from 'xlsx';
import {
  ImportedProductDraft,
  ImportRowError,
  ImportValidationResult,
  ImportPreview,
  ImportPreviewRow,
  ImportAction,
  SUPPORTED_LANGS,
  SupportedLang,
  TEMPLATE_COLUMNS,
  TemplateColumnKey,
} from '../models/import.model';
import {
  Part,
  PartCategory,
  ProductCategory,
  ProductFamily,
  ProductVariant,
  VariantOverride,
} from '../models/catalog.model';
import { CatalogService } from './catalog.service';
import { I18nService } from './i18n.service';

/**
 * Excel template generation + import pipeline.
 *
 * Localization
 * ------------
 * Column headers in the generated template match the active UI language.
 * When parsing, the importer builds a reverse map covering ALL supported
 * languages so a Turkish-uploaded file is parsed correctly even when the
 * UI is in English (and vice versa).
 *
 * Encoding rules (must match the template header):
 *   - Parts cell  → `name|sku|category|price; name|sku|category|price; ...`
 *   - Images cell → `url1; url2; ...`  (first one is primary)
 *   - Tags cell   → `tag1, tag2, tag3`
 */
@Injectable({ providedIn: 'root' })
export class ExcelImportService {
  private readonly catalog = inject(CatalogService);
  private readonly i18n = inject(I18nService);

  private readonly validProductCategories: ProductCategory[] = [
    'slide',
    'swing',
    'climbing',
    'merry-go-round',
    'seesaw',
    'sandbox',
    'playhouse',
    'combo',
    'accessory',
  ];

  private readonly validPartCategories: PartCategory[] = [
    'structure',
    'slide',
    'climb',
    'swing',
    'roof',
    'safety',
    'decoration',
    'foundation',
  ];

  // -------------------------------------------------------------------------
  // Template generation (localized)
  // -------------------------------------------------------------------------

  /**
   * Build the workbook template as an `ArrayBuffer`, with column headers,
   * reference sheet, and example row all translated into the active
   * language.
   */
  generateTemplate(): ArrayBuffer {
    const wb = XLSX.utils.book_new();

    const header: string[] = this.translatedHeaders();
    const exampleRow: (string | number)[] = [
      'CSC-TWR',
      this.i18n.t('category.slide') + ' Tower',
      'slide',
      '5m',
      'CSC-TWR-5M',
      '5m',
      2580,
      'USD',
      '3-12 yrs',
      this.i18n.t('configurator.subtitle').slice(0, 60),
      'outdoor, modular, inclusive',
      'Tower chassis (H235)|CSC-TWR-CHS|structure|920; Slide chute 5m|CSC-CHT-5M|slide|690; EPDM safety mat (4m²)|CSC-SM|safety|240',
      'https://images.unsplash.com/photo-1583694523435-3e6e9f2d2e2c?w=800; https://images.unsplash.com/photo-1565608087341-404b25492fee?w=800',
    ];

    const productsSheet = XLSX.utils.aoa_to_sheet([header, exampleRow]);
    productsSheet['!cols'] = [
      { wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 16 },
      { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 42 },
      { wch: 24 }, { wch: 60 }, { wch: 60 },
    ];
    XLSX.utils.book_append_sheet(wb, productsSheet, this.i18n.t('import.productsSheet'));

    // Reference sheet — translated.
    const productCatLabels = this.validProductCategories.map((c) =>
      this.i18n.t(`category.${c}`),
    );
    const partCatLabels = this.validPartCategories.map((c) =>
      this.i18n.t(`partCategory.${c}`),
    );

    const referenceAoA: (string | number)[][] = [
      [this.i18n.t('import.refTitle')],
      [],
      [this.i18n.t('import.productCategories'), this.i18n.t('import.partCategories')],
      ...this.padPairs(productCatLabels, partCatLabels),
      [],
      [this.i18n.t('import.currencies'), this.i18n.t('import.notes')],
      ['USD', 'US Dollar'],
      ['EUR', 'Euro'],
      ['TRY', 'Turkish Lira'],
      ['GBP', 'British Pound'],
      [],
      [this.i18n.t('import.partsFormat'), this.i18n.t('import.partsFormatValue')],
      [this.i18n.t('import.imagesFormat'), this.i18n.t('import.imagesFormatValue')],
      [this.i18n.t('import.tagsFormat'), this.i18n.t('import.tagsFormatValue')],
    ];
    const referenceSheet = XLSX.utils.aoa_to_sheet(referenceAoA);
    referenceSheet['!cols'] = [{ wch: 28 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, referenceSheet, this.i18n.t('import.referenceSheet'));

    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  }

  /** Translate every column header into the active language. */
  private translatedHeaders(): string[] {
    return (Object.keys(TEMPLATE_COLUMNS) as TemplateColumnKey[]).map(
      (key) => this.i18n.t(TEMPLATE_COLUMNS[key]),
    );
  }

  /** Pad two arrays to the same length so they zip into the reference sheet. */
  private padPairs(a: string[], b: string[]): string[][] {
    const max = Math.max(a.length, b.length);
    const out: string[][] = [];
    for (let i = 0; i < max; i++) {
      out.push([a[i] ?? '', b[i] ?? '']);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Import pipeline
  // -------------------------------------------------------------------------

  /**
   * Parse an uploaded Excel file and validate every row.
   *
   * The function never throws — invalid rows are reported in the result so
   * the UI can show a per-row error table.
   */
  async importFromFile(file: File): Promise<ImportValidationResult> {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });

    // Find the products sheet: try localized name for each supported lang,
    // fall back to the first sheet.
    const sheetName: string | undefined =
      wb.SheetNames.find((n) =>
        SUPPORTED_LANGS.some(() => this.isProductsSheetName(n)),
      ) ?? wb.SheetNames[0];

    const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
    if (!sheet) {
      return this.emptyResult([
        {
          rowIndex: 0,
          columnKey: 'importErrors.sheetColumn',
          severity: 'error',
          messageKey: 'importErrors.missingSheet',
        },
      ]);
    }

    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      blankrows: false,
      defval: '',
    });
    if (rows.length < 2) {
      return this.emptyResult([
        {
          rowIndex: 0,
          columnKey: 'importErrors.sheetColumn',
          severity: 'error',
          messageKey: 'importErrors.noDataRows',
        },
      ]);
    }

    const headerRow = (rows[0] as unknown[]).map((c) => String(c ?? '').trim());
    const colIndex = this.buildColumnIndex(headerRow);

    const errors: ImportRowError[] = [];

    // Validate header completeness — at least one language's headers should
    // match. We don't error on missing headers per-language; we only error
    // if a column key has no recognized header at all.
    const missingKeys = (Object.keys(TEMPLATE_COLUMNS) as TemplateColumnKey[]).filter(
      (key) => colIndex[key] === -1,
    );
    if (missingKeys.length > 0) {
      errors.push({
        rowIndex: 0,
        columnKey: 'importErrors.headerColumn',
        severity: 'error',
        messageKey: 'importErrors.missingHeaders',
        messageParams: { columns: missingKeys.map((k) => this.i18n.t(TEMPLATE_COLUMNS[k])).join(', ') },
      });
    }

    const drafts: ImportedProductDraft[] = [];
    const dataRows = rows.slice(1);
    dataRows.forEach((rawRow, idx) => {
      const rowIndex = idx + 2;
      const row = (rawRow as unknown[]).map((c) => (c == null ? '' : c));
      const draft = this.parseRow(row, colIndex, rowIndex);
      drafts.push(draft);
    });

    const rowErrors: ImportRowError[] = [];
    const rowWarnings: ImportRowError[] = [];
    const valid: ImportedProductDraft[] = [];
    const invalid: ImportedProductDraft[] = [];

    for (const draft of drafts) {
      const { errors: errs, warnings: warns } = this.validateDraft(draft);
      rowErrors.push(...errs);
      rowWarnings.push(...warns);
      if (errs.length === 0) valid.push(draft);
      else invalid.push(draft);
    }

    return {
      valid,
      invalid,
      errors: [...errors, ...rowErrors],
      warnings: rowWarnings,
      totalRows: drafts.length,
    };
  }

  /** Check if a sheet name looks like the Products sheet in any language. */
  private isProductsSheetName(name: string): boolean {
    return SUPPORTED_LANGS.some((lang) => {
      // Hardcoded translations of 'import.productsSheet' for matching.
      const expected = lang === 'tr' ? 'Ürünler' : 'Products';
      return name === expected;
    });
  }

  /**
   * Build a reverse map: for each column key, find the index of the header
   * cell that matches ANY supported language's translation of that key.
   */
  private buildColumnIndex(headerRow: string[]): Record<string, number> {
    const idx: Record<string, number> = {};
    (Object.keys(TEMPLATE_COLUMNS) as TemplateColumnKey[]).forEach((key) => {
      const i18nKey = TEMPLATE_COLUMNS[key];
      const candidates = new Set<string>();
      for (const lang of SUPPORTED_LANGS) {
        const translated = this.translatedHeaderFor(i18nKey, lang);
        if (translated) candidates.add(translated);
      }
      idx[key] = headerRow.findIndex((h) => candidates.has(h));
    });
    return idx;
  }

  /** Look up the known translation of an import-column i18n key per lang. */
  private translatedHeaderFor(i18nKey: string, lang: SupportedLang): string {
    // These are the hardcoded translations matching src/assets/i18n/{en,tr}.json
    const en: Record<string, string> = {
      'importColumns.familyCode': 'Family Code',
      'importColumns.familyName': 'Family Name',
      'importColumns.category': 'Category',
      'importColumns.variantLabel': 'Variant Label',
      'importColumns.variantSku': 'Variant SKU',
      'importColumns.size': 'Size',
      'importColumns.price': 'Price',
      'importColumns.currency': 'Currency',
      'importColumns.ageRange': 'Age Range',
      'importColumns.description': 'Description',
      'importColumns.tags': 'Tags',
      'importColumns.parts': 'Parts (name|sku|category|price; ...)',
      'importColumns.images': 'Images (URL; URL; ...)',
    };
    const tr: Record<string, string> = {
      'importColumns.familyCode': 'Aile Kodu',
      'importColumns.familyName': 'Aile Adı',
      'importColumns.category': 'Kategori',
      'importColumns.variantLabel': 'Varyant Etiketi',
      'importColumns.variantSku': 'Varyant SKU',
      'importColumns.size': 'Boyut',
      'importColumns.price': 'Fiyat',
      'importColumns.currency': 'Para Birimi',
      'importColumns.ageRange': 'Yaş Aralığı',
      'importColumns.description': 'Açıklama',
      'importColumns.tags': 'Etiketler',
      'importColumns.parts': 'Parçalar (ad|sku|kategori|fiyat; ...)',
      'importColumns.images': 'Görseller (URL; URL; ...)',
    };
    const map = lang === 'tr' ? tr : en;
    return map[i18nKey] ?? '';
  }

  /** Coerce a cell to string. */
  private asString(v: unknown): string {
    if (v == null) return '';
    return String(v).trim();
  }

  /** Coerce a cell to number, returning NaN on failure. */
  private asNumber(v: unknown): number {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v;
    const cleaned = String(v).replace(/[^0-9.-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return NaN;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }

  /** Parse a single row into a draft (no validation yet). */
  private parseRow(
    row: unknown[],
    colIndex: Record<string, number>,
    rowIndex: number,
  ): ImportedProductDraft {
    const get = (key: TemplateColumnKey): unknown => {
      const i = colIndex[key];
      if (i < 0) return '';
      return row[i] ?? '';
    };
    return {
      rowIndex,
      familyCode: this.asString(get('familyCode')),
      familyName: this.asString(get('familyName')),
      category: this.asString(get('category')),
      variantLabel: this.asString(get('variantLabel')) || undefined,
      variantSku: this.asString(get('variantSku')),
      size: this.asString(get('size')) || undefined,
      price: this.asNumber(get('price')),
      currency: this.asString(get('currency')),
      ageRange: this.asString(get('ageRange')) || undefined,
      description: this.asString(get('description')),
      tags: this.asString(get('tags'))
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      partsRaw: this.asString(get('parts')),
      imagesRaw: this.asString(get('images')),
    };
  }

  /** Run all validators against a draft; collect errors & warnings. */
  private validateDraft(draft: ImportedProductDraft): {
    errors: ImportRowError[];
    warnings: ImportRowError[];
  } {
    const errors: ImportRowError[] = [];
    const warnings: ImportRowError[] = [];
    const row = draft.rowIndex;

    const require = (key: TemplateColumnKey, value: string | undefined) => {
      if (!value) {
        errors.push({
          rowIndex: row,
          columnKey: TEMPLATE_COLUMNS[key],
          severity: 'error',
          messageKey: 'importErrors.required',
          messageParams: { label: this.i18n.t(TEMPLATE_COLUMNS[key]) },
        });
      }
    };

    require('familyCode', draft.familyCode);
    require('familyName', draft.familyName);
    require('category', draft.category);
    require('variantSku', draft.variantSku);
    require('currency', draft.currency);

    if (
      draft.category &&
      !this.validProductCategories.includes(draft.category as ProductCategory)
    ) {
      errors.push({
        rowIndex: row,
        columnKey: TEMPLATE_COLUMNS.category,
        severity: 'error',
        messageKey: 'importErrors.unknownCategory',
        messageParams: {
          value: draft.category,
          allowed: this.validProductCategories.join(', '),
        },
      });
    }

    if (!Number.isFinite(draft.price) || draft.price < 0) {
      errors.push({
        rowIndex: row,
        columnKey: TEMPLATE_COLUMNS.price,
        severity: 'error',
        messageKey: 'importErrors.badPrice',
      });
    } else if (draft.price === 0) {
      warnings.push({
        rowIndex: row,
        columnKey: TEMPLATE_COLUMNS.price,
        severity: 'warning',
        messageKey: 'importErrors.priceZero',
      });
    }

    if (draft.currency && draft.currency.length !== 3) {
      errors.push({
        rowIndex: row,
        columnKey: TEMPLATE_COLUMNS.currency,
        severity: 'error',
        messageKey: 'importErrors.badCurrency',
      });
    } else if (!draft.currency) {
      errors.push({
        rowIndex: row,
        columnKey: TEMPLATE_COLUMNS.currency,
        severity: 'error',
        messageKey: 'importErrors.currencyRequired',
      });
    }

    // Parts validation: each segment must be name|sku|category|price.
    if (draft.partsRaw) {
      const segments = draft.partsRaw
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const fields = seg.split('|').map((f) => f.trim());
        if (fields.length !== 4) {
          errors.push({
            rowIndex: row,
            columnKey: TEMPLATE_COLUMNS.parts,
            severity: 'error',
            messageKey: 'importErrors.badPartFormat',
            messageParams: { index: i + 1, value: seg },
          });
          continue;
        }
        const [name, sku, category, priceStr] = fields;
        if (!name || !sku || !category || !priceStr) {
          errors.push({
            rowIndex: row,
            columnKey: TEMPLATE_COLUMNS.parts,
            severity: 'error',
            messageKey: 'importErrors.partEmptyFields',
            messageParams: { index: i + 1, value: seg },
          });
        }
        if (
          category &&
          !this.validPartCategories.includes(category as PartCategory)
        ) {
          errors.push({
            rowIndex: row,
            columnKey: TEMPLATE_COLUMNS.parts,
            severity: 'error',
            messageKey: 'importErrors.badPartCategory',
            messageParams: {
              index: i + 1,
              value: category,
              allowed: this.validPartCategories.join(', '),
            },
          });
        }
        const price = Number(priceStr);
        if (!Number.isFinite(price) || price < 0) {
          errors.push({
            rowIndex: row,
            columnKey: TEMPLATE_COLUMNS.parts,
            severity: 'error',
            messageKey: 'importErrors.badPartPrice',
            messageParams: { index: i + 1, value: priceStr },
          });
        }
      }
    } else {
      warnings.push({
        rowIndex: row,
        columnKey: TEMPLATE_COLUMNS.parts,
        severity: 'warning',
        messageKey: 'importErrors.noPartsWarning',
      });
    }

    // Images validation: each segment must be a non-empty URL-looking string.
    if (draft.imagesRaw) {
      const urls = draft.imagesRaw
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        if (!/^https?:\/\/.+/i.test(url) && !/^data:image\//i.test(url)) {
          errors.push({
            rowIndex: row,
            columnKey: TEMPLATE_COLUMNS.images,
            severity: 'error',
            messageKey: 'importErrors.badImage',
            messageParams: { index: i + 1, value: url },
          });
        }
      }
    }

    return { errors, warnings };
  }

  // -------------------------------------------------------------------------
  // Apply validated drafts to the catalog
  // -------------------------------------------------------------------------

  /**
   * Convert validated drafts into families & variants, then replace the
   * catalog. Returns the count of newly-created families and variants.
   */
  /**
   * Generate a preview of what the import will do — which families will be
   * created vs updated, which variants will be created vs updated, and any
   * conflicts (duplicate SKUs within the file, same family name with
   * different code, etc.).
   *
   * The preview is generated BEFORE `applyDrafts()` so the user can see
   * exactly what will happen and deselect specific rows.
   */
  generatePreview(drafts: ImportedProductDraft[], mode: 'replace' | 'merge' = 'merge'): ImportPreview {
    const existingByCode = new Map(
      this.catalog.families().map((f) => [f.code.toLowerCase(), f]),
    );
    const existingVariantsByFamilySku = new Map<string, ProductVariant>();
    for (const v of this.catalog.variants()) {
      const fam = existingByCode.get(
        this.catalog.families().find((f) => f.id === v.familyId)?.code?.toLowerCase() ?? '',
      );
      if (fam) {
        existingVariantsByFamilySku.set(`${fam.code.toLowerCase()}:${v.sku.toLowerCase()}`, v);
      }
    }

    // Track codes/SKUs seen within this file to detect intra-file duplicates.
    const seenCodesInFile = new Map<string, number>();
    const seenSkusInFile = new Map<string, number>();
    const seenNamesInFile = new Map<string, string>();

    // First pass: collect counts.
    for (const d of drafts) {
      const codeKey = d.familyCode.toLowerCase();
      seenCodesInFile.set(codeKey, (seenCodesInFile.get(codeKey) ?? 0) + 1);
      const skuKey = `${codeKey}:${d.variantSku.toLowerCase()}`;
      seenSkusInFile.set(skuKey, (seenSkusInFile.get(skuKey) ?? 0) + 1);
      const existingName = seenNamesInFile.get(d.familyName.toLowerCase());
      if (existingName && existingName !== d.familyCode) {
        // Different code, same name — will be flagged as conflict.
      } else {
        seenNamesInFile.set(d.familyName.toLowerCase(), d.familyCode);
      }
    }

    const rows: ImportPreviewRow[] = [];
    let newFamilies = 0;
    let updatedFamilies = 0;
    let newVariants = 0;
    let updatedVariants = 0;
    let conflictCount = 0;

    // Track which codes we've already counted as "new family" so we don't
    // double-count when multiple rows share the same code.
    const countedNewCodes = new Set<string>();
    const countedUpdatedCodes = new Set<string>();

    for (const d of drafts) {
      const codeKey = d.familyCode.toLowerCase();
      const skuKey = `${codeKey}:${d.variantSku.toLowerCase()}`;
      const conflicts: string[] = [];

      // Intra-file duplicate family code.
      if ((seenCodesInFile.get(codeKey) ?? 0) > 1) {
        const firstIdx = drafts.findIndex(
          (x) => x.familyCode.toLowerCase() === codeKey,
        );
        if (drafts.indexOf(d) !== firstIdx) {
          conflicts.push('duplicate_code_in_file');
        }
      }

      // Intra-file duplicate variant SKU.
      if ((seenSkusInFile.get(skuKey) ?? 0) > 1) {
        const firstIdx = drafts.findIndex(
          (x) =>
            x.familyCode.toLowerCase() === codeKey &&
            x.variantSku.toLowerCase() === d.variantSku.toLowerCase(),
        );
        if (drafts.indexOf(d) !== firstIdx) {
          conflicts.push('duplicate_sku_in_file');
        }
      }

      // Same family name but different code (potential confusion).
      const nameOwner = seenNamesInFile.get(d.familyName.toLowerCase());
      if (nameOwner && nameOwner !== d.familyCode) {
        conflicts.push('name_mismatch');
      }

      let action: ImportAction;
      if (mode === 'replace') {
        action = countedNewCodes.has(codeKey) ? 'create-variant' : 'create-family';
        if (!countedNewCodes.has(codeKey)) {
          countedNewCodes.add(codeKey);
          newFamilies++;
        }
        newVariants++;
      } else {
        // Merge mode.
        const existingFamily = existingByCode.get(codeKey);
        if (existingFamily) {
          // Family exists — check variant.
          const existingVariant = existingVariantsByFamilySku.get(skuKey);
          if (existingVariant) {
            action = 'update-variant';
            updatedVariants++;
          } else {
            action = 'create-variant';
            newVariants++;
          }
          if (!countedUpdatedCodes.has(codeKey)) {
            countedUpdatedCodes.add(codeKey);
            updatedFamilies++;
          }
        } else {
          // New family.
          action = countedNewCodes.has(codeKey) ? 'create-variant' : 'create-family';
          if (!countedNewCodes.has(codeKey)) {
            countedNewCodes.add(codeKey);
            newFamilies++;
          }
          newVariants++;
        }
      }

      if (conflicts.length > 0) conflictCount += conflicts.length;

      rows.push({
        draft: d,
        action,
        selected: conflicts.length === 0, // auto-deselect conflicted rows
        conflicts,
      });
    }

    return {
      rows,
      newFamilies,
      updatedFamilies,
      newVariants,
      updatedVariants,
      conflicts: conflictCount,
    };
  }

  /**
   * Convert validated drafts into families & variants and apply them.
   *
   * `mode`:
   *   - `'replace'` — clears the catalog and writes only the imported rows.
   *   - `'merge'`   — keeps existing families/variants; for each imported
   *     family code, if a family with that code already exists it's updated
   *     (new variants are added, existing variants with the same SKU are
   *     updated, other families are left untouched). If the code doesn't
   *     exist, the family is added as new.
   */
  applyDrafts(
    drafts: ImportedProductDraft[],
    mode: 'replace' | 'merge' = 'replace',
  ): { families: number; variants: number; created: number; updated: number } {
    const byFamilyCode = new Map<string, ImportedProductDraft[]>();
    for (const d of drafts) {
      const list = byFamilyCode.get(d.familyCode) ?? [];
      list.push(d);
      byFamilyCode.set(d.familyCode, list);
    }

    const now = Date.now();

    if (mode === 'replace') {
      // Old behavior: wipe everything, write only the new data.
      const { families, variants } = this.buildFromDrafts(byFamilyCode, now);
      this.catalog.replaceAll(families, variants);
      return {
        families: families.length,
        variants: variants.length,
        created: families.length,
        updated: 0,
      };
    }

    // Merge mode: start from existing catalog, update/add as needed.
    const existingFamilies = [...this.catalog.families()];
    const existingVariants = [...this.catalog.variants()];
    const existingByCode = new Map(existingFamilies.map((f) => [f.code, f]));
    let created = 0;
    let updated = 0;

    for (const [code, group] of byFamilyCode) {
      const head = group[0];
      const parts = this.parseParts(head.partsRaw);
      const images = this.parseImages(head.imagesRaw);

      const existing = existingByCode.get(code);
      if (existing) {
        // Update the existing family's fields.
        existing.name = head.familyName;
        existing.category = head.category as ProductCategory;
        existing.description = head.description || '';
        existing.ageRange = head.ageRange;
        existing.currency = head.currency || 'USD';
        existing.tags = head.tags;
        existing.images = images;
        existing.availableParts = parts;
        existing.updatedAt = now;
        updated++;

        // Process variants: match by SKU.
        const existingVariantsBySku = new Map(
          existingVariants
            .filter((v) => v.familyId === existing.id)
            .map((v) => [v.sku, v]),
        );

        for (const draft of group) {
          const overrides = this.buildOverrides(draft, parts, head);
          const existingVariant = existingVariantsBySku.get(draft.variantSku);
          if (existingVariant) {
            // Update in place.
            existingVariant.label = draft.variantLabel || 'Standard';
            existingVariant.active = true;
            existingVariant.overrides = overrides;
            existingVariant.updatedAt = now;
          } else {
            // New variant for this family.
            const newVariant: ProductVariant = {
              id: crypto.randomUUID(),
              familyId: existing.id,
              label: draft.variantLabel || 'Standard',
              sku: draft.variantSku,
              active: true,
              overrides,
              createdAt: now,
              updatedAt: now,
            };
            existingVariants.push(newVariant);
          }
        }
      } else {
        // New family — add it.
        const family: ProductFamily = {
          id: crypto.randomUUID(),
          name: head.familyName,
          code,
          category: head.category as ProductCategory,
          description: head.description || '',
          ageRange: head.ageRange,
          currency: head.currency || 'USD',
          tags: head.tags,
          images,
          availableParts: parts,
          createdAt: now,
          updatedAt: now,
        };
        existingFamilies.push(family);
        existingByCode.set(code, family);
        created++;

        for (const draft of group) {
          const overrides = this.buildOverrides(draft, parts, head);
          const variant: ProductVariant = {
            id: crypto.randomUUID(),
            familyId: family.id,
            label: draft.variantLabel || 'Standard',
            sku: draft.variantSku,
            active: true,
            overrides,
            createdAt: now,
            updatedAt: now,
          };
          existingVariants.push(variant);
        }
      }
    }

    this.catalog.replaceAll(existingFamilies, existingVariants);
    return {
      families: existingFamilies.length,
      variants: existingVariants.length,
      created,
      updated,
    };
  }

  /** Build variant overrides from a draft + family parts. */
  private buildOverrides(
    draft: ImportedProductDraft,
    parts: Part[],
    head: ImportedProductDraft,
  ): VariantOverride[] {
    const overrides: VariantOverride[] = [];
    if (draft.size) overrides.push({ key: 'size', value: draft.size });
    overrides.push({ key: 'price', value: draft.price });
    if (draft.currency && draft.currency !== (head.currency || 'USD')) {
      overrides.push({ key: 'currency', value: draft.currency });
    }
    if (draft.ageRange && draft.ageRange !== head.ageRange) {
      overrides.push({ key: 'ageRange', value: draft.ageRange });
    }

    const rowParts = this.parseParts(draft.partsRaw);
    const skuToId = new Map(parts.map((p) => [p.sku, p.id]));
    const partIds = rowParts
      .map((p) => skuToId.get(p.sku))
      .filter((id): id is string => id != null);
    if (partIds.length > 0) {
      overrides.push({ key: 'parts', value: partIds });
    }

    const rowImages = this.parseImages(draft.imagesRaw);
    if (rowImages.length > 0) {
      overrides.push({ key: 'images', value: rowImages });
    }

    return overrides;
  }

  /** Build families + variants from drafts (used by replace mode). */
  private buildFromDrafts(
    byFamilyCode: Map<string, ImportedProductDraft[]>,
    now: number,
  ): { families: ProductFamily[]; variants: ProductVariant[] } {
    const families: ProductFamily[] = [];
    const variants: ProductVariant[] = [];

    for (const [code, group] of byFamilyCode) {
      const head = group[0];
      const parts = this.parseParts(head.partsRaw);
      const images = this.parseImages(head.imagesRaw);

      const family: ProductFamily = {
        id: crypto.randomUUID(),
        name: head.familyName,
        code,
        category: head.category as ProductCategory,
        description: head.description || '',
        ageRange: head.ageRange,
        currency: head.currency || 'USD',
        tags: head.tags,
        images,
        availableParts: parts,
        createdAt: now,
        updatedAt: now,
      };
      families.push(family);

      for (const draft of group) {
        const overrides = this.buildOverrides(draft, parts, head);
        variants.push({
          id: crypto.randomUUID(),
          familyId: family.id,
          label: draft.variantLabel || 'Standard',
          sku: draft.variantSku,
          active: true,
          overrides,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return { families, variants };
  }

  /** Parse a `name|sku|category|price; ...` cell into `Part[]`. */
  private parseParts(raw: string): Part[] {
    if (!raw) return [];
    return raw
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((seg, idx) => {
        const [name, sku, category, priceStr] = seg
          .split('|')
          .map((f) => f.trim());
        const price = Number(priceStr) || 0;
        return {
          id: `imp-part-${idx}-${sku}`,
          name,
          sku,
          category: category as PartCategory,
          price,
        };
      });
  }

  /** Parse a `url; url; ...` cell into image records. */
  private parseImages(raw: string): { id: string; url: string; isPrimary: boolean; alt?: string }[] {
    if (!raw) return [];
    return raw
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((url, idx) => ({
        id: `imp-img-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        url,
        isPrimary: idx === 0,
        alt: '',
      }));
  }

  private emptyResult(errors: ImportRowError[]): ImportValidationResult {
    return {
      valid: [],
      invalid: [],
      errors,
      warnings: [],
      totalRows: 0,
    };
  }
}
