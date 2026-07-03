import { Component, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ExcelImportService } from '../../core/services/excel-import.service';
import { CatalogService } from '../../core/services/catalog.service';
import { I18nService } from "../../core/services/i18n.service";
import {
  ImportValidationResult,
  ImportPreview,
  ImportPreviewRow,
} from '../../core/models/import.model';
import { IconComponent } from '../../shared/components/icon.component';
import { ButtonComponent } from '../../shared/components/button.component';

export type ImportMode = 'merge' | 'replace';

/**
 * Excel import wizard with preview + row selection.
 *
 * Flow:
 *   1. Download template.
 *   2. Upload workbook → validation.
 *   3. Preview: see what will happen per-row (new family / update family /
 *      new variant / update variant), conflicts flagged + auto-deselected.
 *      User can toggle individual rows with checkboxes.
 *   4. Choose merge vs replace mode.
 *   5. Apply — only selected rows are imported.
 */
@Component({
  selector: 'app-import-page',
  standalone: true,
  imports: [IconComponent, ButtonComponent, TranslatePipe],
  templateUrl: './import-page.html',
  styleUrl: './import-page.scss',
})
export class ImportPage {
  private readonly excel = inject(ExcelImportService);
  private readonly catalog = inject(CatalogService);
  private readonly i18n = inject(I18nService);

  readonly isParsing = signal(false);
  readonly isDragging = signal(false);
  readonly result = signal<ImportValidationResult | null>(null);
  readonly preview = signal<ImportPreview | null>(null);
  readonly applied = signal<{ families: number; variants: number; created: number; updated: number } | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly downloadMessage = signal<string | null>(null);

  readonly importMode = signal<ImportMode>('merge');
  readonly stats = signal({ families: 0, variants: 0 });

  /** Selected row count — computed from preview. */
  readonly selectedCount = computed(() => {
    const p = this.preview();
    return p ? p.rows.filter((r) => r.selected).length : 0;
  });

  constructor() {
    this.stats.set({
      families: this.catalog.families().length,
      variants: this.catalog.variants().length,
    });
  }

  setMode(mode: ImportMode): void {
    this.importMode.set(mode);
    // Regenerate preview with new mode.
    const res = this.result();
    if (res && res.valid.length > 0) {
      this.preview.set(this.excel.generatePreview(res.valid, mode));
    }
  }

  toggleRow(row: ImportPreviewRow): void {
    this.preview.update((p) => {
      if (!p) return p;
      return {
        ...p,
        rows: p.rows.map((r) =>
          r.draft.rowIndex === row.draft.rowIndex
            ? { ...r, selected: !r.selected }
            : r,
        ),
      };
    });
  }

  selectAll(): void {
    this.preview.update((p) => {
      if (!p) return p;
      return { ...p, rows: p.rows.map((r) => ({ ...r, selected: true })) };
    });
  }

  deselectAll(): void {
    this.preview.update((p) => {
      if (!p) return p;
      return { ...p, rows: p.rows.map((r) => ({ ...r, selected: false })) };
    });
  }

  downloadTemplate(): void {
    const buffer = this.excel.generateTemplate();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'playforge-template.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    this.downloadMessage.set('Template downloaded as playforge-template.xlsx. Check your Downloads folder or the browser download prompt.');
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void this.parse(file);
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(true);
  }
  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
  }
  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) void this.parse(file);
  }

  private async parse(file: File): Promise<void> {
    this.isParsing.set(true);
    this.applied.set(null);
    this.errorMessage.set(null);
    this.preview.set(null);
    try {
      const res = await this.excel.importFromFile(file);
      this.result.set(res);
      if (res.valid.length > 0) {
        this.preview.set(this.excel.generatePreview(res.valid, this.importMode()));
      }
    } catch (err) {
      console.error(err);
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to read the workbook.',
      );
    } finally {
      this.isParsing.set(false);
    }
  }

  applyImport(): void {
    const p = this.preview();
    if (!p) return;
    const selectedDrafts = p.rows.filter((r) => r.selected).map((r) => r.draft);
    if (selectedDrafts.length === 0) return;
    const summary = this.excel.applyDrafts(selectedDrafts, this.importMode());
    this.applied.set(summary);
    this.stats.set({
      families: this.catalog.families().length,
      variants: this.catalog.variants().length,
    });
  }

  reset(): void {
    this.result.set(null);
    this.preview.set(null);
    this.applied.set(null);
    this.errorMessage.set(null);
    this.downloadMessage.set(null);
  }

  conflictLabel(conflict: string): string {
    const map: Record<string, string> = {
      duplicate_code_in_file: this.i18n.t('import.conflictDuplicateCode'),
      duplicate_sku_in_file: this.i18n.t('import.conflictDuplicateSku'),
      name_mismatch: this.i18n.t('import.conflictNameMismatch'),
    };
    return map[conflict] ?? conflict;
  }

  actionLabel(action: string): string {
    const map: Record<string, string> = {
      'create-family': this.i18n.t('import.actionCreateFamily'),
      'update-family': this.i18n.t('import.actionUpdateFamily'),
      'create-variant': this.i18n.t('import.actionCreateVariant'),
      'update-variant': this.i18n.t('import.actionUpdateVariant'),
    };
    return map[action] ?? action;
  }
}
