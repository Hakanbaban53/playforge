import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ExcelImportService } from './excel-import.service';
import { CatalogService } from './catalog.service';
import * as XLSX from 'xlsx';

/**
 * ExcelImportService tests.
 *
 * Verifies the template generation + row parser + validator + apply pipeline
 * against synthetic workbooks covering valid and invalid rows. The parser is
 * language-agnostic — it accepts headers in any of the supported languages
 * by building a reverse map at parse time.
 */
describe('ExcelImportService', () => {
  let service: ExcelImportService;
  let catalog: CatalogService;
  

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({}),
      ],
    });
    service = TestBed.inject(ExcelImportService);
    catalog = TestBed.inject(CatalogService);
    catalog.clearAll();
  });

  it('generates a valid .xlsx template', () => {
    const buf = service.generateTemplate();
    expect(buf.byteLength).toBeGreaterThan(0);

    const wb = XLSX.read(buf, { type: 'array' });
    expect(wb.SheetNames.length).toBeGreaterThanOrEqual(1);

    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
    expect(rows.length).toBeGreaterThanOrEqual(2); // header + example row

    const header = rows[0] as string[];
    // Headers depend on the active language. Default is 'en' (no translations
    // loaded in tests, so the I18nService falls back to the i18n key itself).
    // We just verify the header has the right number of columns.
    expect(header.length).toBe(13);
  });

  it('parses a fully-valid English workbook', async () => {
    const file = makeWorkbook([
      ['Family Code', 'Family Name', 'Category', 'Variant Label', 'Variant SKU',
        'Size', 'Price', 'Currency', 'Age Range', 'Description', 'Tags',
        'Parts (name|sku|category|price; ...)', 'Images (URL; URL; ...)'],
      ['TWR', 'Tower Slide', 'slide', '3m', 'TWR-3M', '3m', 2025, 'USD', '3-12', 'desc', 'outdoor',
        'Chassis|TWR-CHS|structure|920; Chute|TWR-CHT|slide|410',
        'https://example.com/a.jpg'],
    ]);

    const result = await service.importFromFile(file);
    expect(result.totalRows).toBe(1);
    expect(result.valid.length).toBe(1);
    expect(result.invalid.length).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  it('parses a fully-valid Turkish workbook', async () => {
    // Same content but with Turkish headers — the parser must still recognize
    // every column.
    const file = makeWorkbook([
      ['Aile Kodu', 'Aile Adı', 'Kategori', 'Varyant Etiketi', 'Varyant SKU',
        'Boyut', 'Fiyat', 'Para Birimi', 'Yaş Aralığı', 'Açıklama', 'Etiketler',
        'Parçalar (ad|sku|kategori|fiyat; ...)', 'Görseller (URL; URL; ...)'],
      ['TWR', 'Tower Slide', 'slide', '3m', 'TWR-3M', '3m', 2025, 'USD', '3-12', 'desc', 'outdoor',
        'Chassis|TWR-CHS|structure|920; Chute|TWR-CHT|slide|410',
        'https://example.com/a.jpg'],
    ]);

    const result = await service.importFromFile(file);
    expect(result.totalRows).toBe(1);
    expect(result.valid.length).toBe(1);
    expect(result.invalid.length).toBe(0);
  });

  it('rejects rows with missing required fields', async () => {
    const file = makeWorkbook([
      ['Family Code', 'Family Name', 'Category', 'Variant Label', 'Variant SKU',
        'Size', 'Price', 'Currency', 'Age Range', 'Description', 'Tags',
        'Parts (name|sku|category|price; ...)', 'Images (URL; URL; ...)'],
      ['', 'Missing Code', 'slide', '1m', 'MISS-1', '1m', 500, 'USD', '', '', '', '', ''],
    ]);
    const result = await service.importFromFile(file);
    expect(result.invalid.length).toBe(1);
    expect(result.errors.some(e => e.columnKey === 'importColumns.familyCode')).toBe(true);
  });

  it('rejects rows with non-numeric prices', async () => {
    const file = makeWorkbook([
      ['Family Code', 'Family Name', 'Category', 'Variant Label', 'Variant SKU',
        'Size', 'Price', 'Currency', 'Age Range', 'Description', 'Tags',
        'Parts (name|sku|category|price; ...)', 'Images (URL; URL; ...)'],
      ['BAD', 'Bad Price', 'slide', '1m', 'BAD-1', '1m', 'NOT_A_NUMBER', 'USD', '', '', '', '', ''],
    ]);
    const result = await service.importFromFile(file);
    expect(result.invalid.length).toBe(1);
    expect(result.errors.some(e => e.columnKey === 'importColumns.price')).toBe(true);
  });

  it('rejects rows with unknown categories', async () => {
    const file = makeWorkbook([
      ['Family Code', 'Family Name', 'Category', 'Variant Label', 'Variant SKU',
        'Size', 'Price', 'Currency', 'Age Range', 'Description', 'Tags',
        'Parts (name|sku|category|price; ...)', 'Images (URL; URL; ...)'],
      ['CAT', 'Bad Category', 'not-a-real-category', '1m', 'CAT-1', '1m', 500, 'USD', '', '', '', '', ''],
    ]);
    const result = await service.importFromFile(file);
    expect(result.invalid.length).toBe(1);
    expect(result.errors.some(e => e.messageKey === 'importErrors.unknownCategory')).toBe(true);
  });

  it('rejects malformed parts cells', async () => {
    const file = makeWorkbook([
      ['Family Code', 'Family Name', 'Category', 'Variant Label', 'Variant SKU',
        'Size', 'Price', 'Currency', 'Age Range', 'Description', 'Tags',
        'Parts (name|sku|category|price; ...)', 'Images (URL; URL; ...)'],
      ['MAL', 'Malformed', 'slide', '1m', 'MAL-1', '1m', 500, 'USD', '', '', '',
        'Just a name without pipes', ''],
    ]);
    const result = await service.importFromFile(file);
    expect(result.invalid.length).toBe(1);
    expect(result.errors.some(e => e.columnKey === 'importColumns.parts')).toBe(true);
  });

  it('rejects invalid image URLs', async () => {
    const file = makeWorkbook([
      ['Family Code', 'Family Name', 'Category', 'Variant Label', 'Variant SKU',
        'Size', 'Price', 'Currency', 'Age Range', 'Description', 'Tags',
        'Parts (name|sku|category|price; ...)', 'Images (URL; URL; ...)'],
      ['IMG', 'Bad Image', 'slide', '1m', 'IMG-1', '1m', 500, 'USD', '', '', '', '',
        'not-a-url'],
    ]);
    const result = await service.importFromFile(file);
    expect(result.invalid.length).toBe(1);
    expect(result.errors.some(e => e.columnKey === 'importColumns.images')).toBe(true);
  });

  it('applies valid drafts to the catalog, replacing it', async () => {
    const file = makeWorkbook([
      ['Family Code', 'Family Name', 'Category', 'Variant Label', 'Variant SKU',
        'Size', 'Price', 'Currency', 'Age Range', 'Description', 'Tags',
        'Parts (name|sku|category|price; ...)', 'Images (URL; URL; ...)'],
      ['NEW1', 'Family One', 'slide', 'Std', 'NEW1-STD', '1m', 500, 'USD', '', '', '',
        'Part A|PA|structure|100', 'https://example.com/a.jpg'],
      ['NEW2', 'Family Two', 'swing', 'Std', 'NEW2-STD', '2m', 800, 'USD', '', '', '',
        'Part B|PB|structure|200', 'https://example.com/b.jpg'],
    ]);
    const result = await service.importFromFile(file);
    expect(result.valid.length).toBe(2);

    const summary = service.applyDrafts(result.valid);
    expect(summary.families).toBe(2);
    expect(summary.variants).toBe(2);

    expect(catalog.families().length).toBe(2);
    const codes = catalog.families().map(f => f.code);
    expect(codes).toContain('NEW1');
    expect(codes).toContain('NEW2');
  });

  // ---- helpers ----

  function makeWorkbook(rows: (string | number)[][]): File {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    return new File([buf], 'test.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }
});
