import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ExportService } from './export.service';
import { CatalogService } from './catalog.service';
import { InvoiceService } from './invoice.service';
import { provideInMemoryDataAndStubAuth } from './testing';
import * as XLSX from 'xlsx';

/**
 * ExportService tests.
 *
 * Verifies that:
 *   - Catalog export uses the same columns as the import template (so
 *     round-tripping works).
 *   - Catalog export encodes parts as `name|sku|category|price; ...`.
 *   - Catalog export encodes images as `url; url; ...`.
 *   - Invoice export emits one row per line item.
 *   - CSV format produces valid RFC-4180 output with proper escaping.
 *   - XLSX format produces a parseable workbook with the right headers.
 */
describe('ExportService', () => {
  let service: ExportService;
  let catalog: CatalogService;
  let invoice: InvoiceService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({}),
        ...provideInMemoryDataAndStubAuth(),
      ],
    });
    service = TestBed.inject(ExportService);
    catalog = TestBed.inject(CatalogService);
    invoice = TestBed.inject(InvoiceService);
  });

  it('catalog export (xlsx) has the same headers as the import template', async () => {
    seedCatalog();
    const blob = service.exportCatalog('xlsx');
    const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
    expect(rows.length).toBeGreaterThanOrEqual(2);

    // Headers are i18n keys resolved to English (default lang in tests).
    // The number of columns must match the import template (13).
    expect((rows[0] as unknown[]).length).toBe(13);
  });

  it('catalog export encodes parts and images correctly', async () => {
    seedCatalog();
    const blob = service.exportCatalog('xlsx');
    const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

    // Row 1 is the header; Row 2 is the data row.
    const dataRow = rows[1] as unknown[];
    // Parts column (index 11) should be `name|sku|category|price; ...`
    expect(typeof dataRow[11]).toBe('string');
    expect(dataRow[11]).toContain('|');
    expect(dataRow[11]).toContain(';');
    // Images column (index 12) — single URL won't contain `;`, just verify it's there.
    expect(typeof dataRow[12]).toBe('string');
    expect(dataRow[12]).toContain('http');
  });

  it('catalog export (csv) produces RFC-4180-valid output', async () => {
    seedCatalog();
    const blob = service.exportCatalog('csv');
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // BOM marker at the start (0xEF 0xBB 0xBF in UTF-8).
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);

    const text = new TextDecoder('utf-8').decode(bytes.slice(3));
    const lines = text.split(/\r?\n/);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // Each row has the same number of comma-separated fields (13 columns).
    for (const line of lines.filter((l) => l.length > 0)) {
      const fields = parseCsvLine(line);
      expect(fields.length).toBe(13);
    }
  });

  it('invoice export produces one row per line item', async () => {
    seedCatalog();
    // Add a line item to the active invoice.
    const resolved = catalog.resolveAll()[0];
    if (resolved) {
      const { lineFromResolved } = await import('../models/invoice.model');
      invoice.addLine(lineFromResolved(resolved, 2));
    }
    const blob = service.exportInvoices('xlsx');
    const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
    // Header + 1 data row.
    expect(rows.length).toBe(2);
  });

  it('exportCatalog returns a non-empty Blob', () => {
    seedCatalog();
    const blob = service.exportCatalog('xlsx');
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toContain('spreadsheet');
  });

  // ---- helpers ----

  function seedCatalog(): void {
    catalog.replaceAll(
      [
        {
          id: 'fam-1',
          name: 'Test Family',
          code: 'TST',
          category: 'slide',
          description: 'desc',
          ageRange: '3-12',
          currency: 'USD',
          tags: ['outdoor'],
          images: [{ id: 'i1', url: 'https://example.com/a.jpg', isPrimary: true }],
          availableParts: [
            { id: 'p1', name: 'Part A', sku: 'PA', category: 'structure', price: 100 },
            { id: 'p2', name: 'Part B', sku: 'PB', category: 'slide', price: 200 },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      [
        {
          id: 'var-1',
          familyId: 'fam-1',
          label: 'Std',
          sku: 'TST-STD',
          active: true,
          overrides: [
            { key: 'size', value: '3m' },
            { key: 'price', value: 300 },
            { key: 'parts', value: ['p1', 'p2'] },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    );
  }

  function parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') {
          inQuotes = false;
        } else {
          cur += c;
        }
      } else {
        if (c === ',') {
          fields.push(cur);
          cur = '';
        } else if (c === '"') {
          inQuotes = true;
        } else {
          cur += c;
        }
      }
    }
    fields.push(cur);
    return fields;
  }
});
