import { Component, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ExcelImportService } from '../../core/services/excel-import.service';
import { AppSettingsService, AppSettingsImportResult } from '../../core/services/app-settings.service';
import { CatalogService } from '../../core/services/catalog.service';
import { CustomersService } from '../../core/services/customers.service';
import { I18nService } from "../../core/services/i18n.service";
import {
  ImportValidationResult,
  ImportPreview,
  ImportPreviewRow,
  CustomerImportValidationResult,
  ImportedCustomerDraft,
  ImportedProductDraft,
} from '../../core/models/import.model';
import { IconComponent } from '../../shared/components/icon.component';
import { ButtonComponent } from '../../shared/components/button.component';

export type ImportMode = 'merge' | 'replace';
export type ImportTarget = 'catalog' | 'customers' | 'settings';

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
  private readonly appSettings = inject(AppSettingsService);
  private readonly catalog = inject(CatalogService);
  private readonly customersSvc = inject(CustomersService);
  private readonly i18n = inject(I18nService);

  readonly isParsing = signal(false);
  readonly isDragging = signal(false);
  readonly result = signal<ImportValidationResult | null>(null);
  readonly preview = signal<ImportPreview | null>(null);
  readonly applied = signal<{ families: number; variants: number; created: number; updated: number } | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly downloadMessage = signal<string | null>(null);

  readonly importMode = signal<ImportMode>('merge');
  readonly importTarget = signal<ImportTarget>('catalog');
  readonly stats = signal({ families: 0, variants: 0 });

  // Customer import state
  readonly customerResult = signal<CustomerImportValidationResult | null>(null);
  readonly customerPreview = signal<ImportPreview | null>(null);
  readonly customerApplied = signal<{ created: number; updated: number } | null>(null);

  // App settings import state
  readonly settingsResult = signal<AppSettingsImportResult | null>(null);
  readonly settingsApplied = signal<{ applied: string[]; skipped: string[] } | null>(null);
  /** Section selection toggles for app-settings import. */
  readonly settingsSectionSelected = signal<Record<string, boolean>>({});

  /** Selected row count — computed from the active preview. */
  readonly selectedCount = computed(() => {
    if (this.importTarget() === 'settings') {
      return this.settingsSelectedSectionCount();
    }
    const p = this.activePreview();
    return p ? p.rows.filter((r) => r.selected).length : 0;
  });

  readonly customerCount = computed(() => this.customersSvc.customers().length);

  /** Sections present in the validated settings bundle, in display order. */
  readonly settingsSections = computed<string[]>(() => {
    const r = this.settingsResult();
    if (!r?.bundle) return [];
    const bundle = r.bundle as unknown as Record<string, unknown>;
    const order: string[] = ['receiptLayout', 'invoiceDefaults', 'currency', 'favorites'];
    return order.filter((k) => bundle[k] !== undefined);
  });

  /** How many sections the user has ticked for import. */
  readonly settingsSelectedSectionCount = computed(() => {
    const sel = this.settingsSectionSelected();
    return this.settingsSections().filter((k) => sel[k] !== false).length;
  });

  /** Per-section errors from the settings validation result. */
  readonly settingsSectionErrors = computed(() => {
    const r = this.settingsResult();
    if (!r) return [];
    return r.errors;
  });

  /** Returns whichever preview is active based on importTarget. */
  readonly activePreview = computed(() => {
    return this.importTarget() === 'customers' ? this.customerPreview() : this.preview();
  });

  readonly activeResult = computed(() => {
    return this.importTarget() === 'customers' ? this.customerResult() : this.result();
  });

  readonly hasActiveErrors = computed(() => {
    const r = this.activeResult();
    if (!r) return false;
    return r.errors.length > 0;
  });

  readonly activeErrors = computed(() => {
    const r = this.activeResult();
    if (!r) return [];
    return r.errors;
  });

  readonly activeWarnings = computed(() => {
    const r = this.activeResult();
    if (!r) return [];
    return r.warnings;
  });

  readonly activeValidCount = computed(() => {
    const r = this.activeResult();
    if (!r) return 0;
    return r.valid.length;
  });

  readonly activeInvalidCount = computed(() => {
    const r = this.activeResult();
    if (!r) return 0;
    return r.invalid.length;
  });

  readonly activeTotalRows = computed(() => {
    const r = this.activeResult();
    if (!r) return 0;
    return r.totalRows;
  });

  constructor() {
    this.stats.set({
      families: this.catalog.families().length,
      variants: this.catalog.variants().length,
    });
  }

  setTarget(target: ImportTarget): void {
    this.importTarget.set(target);
    this.reset();
  }

  setMode(mode: ImportMode): void {
    this.importMode.set(mode);
    const catRes = this.result();
    if (catRes && catRes.valid.length > 0) {
      this.preview.set(this.excel.generatePreview(catRes.valid, mode));
    }
    const custRes = this.customerResult();
    if (custRes && custRes.valid.length > 0) {
      this.customerPreview.set(this.excel.generateCustomerPreview(custRes.valid, mode));
    }
  }

  private updateActivePreview(updater: (p: ImportPreview | null) => ImportPreview | null): void {
    if (this.importTarget() === 'customers') {
      this.customerPreview.update(updater);
    } else {
      this.preview.update(updater);
    }
  }

  toggleRow(row: ImportPreviewRow): void {
    this.updateActivePreview((p) => {
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
    this.updateActivePreview((p) => {
      if (!p) return p;
      return { ...p, rows: p.rows.map((r) => ({ ...r, selected: true })) };
    });
  }

  deselectAll(): void {
    this.updateActivePreview((p) => {
      if (!p) return p;
      return { ...p, rows: p.rows.map((r) => ({ ...r, selected: false })) };
    });
  }

  downloadTemplate(): void {
    if (this.importTarget() === 'settings') {
      // No template to download — JSON bundles are produced by the export
      // page. We just point the user there.
      this.downloadMessage.set(this.i18n.t('import.settingsNoTemplate'));
      return;
    }
    if (this.importTarget() === 'customers') {
      const buffer = this.excel.generateCustomerTemplate();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'playforge-customers-template.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      this.downloadMessage.set(this.i18n.t('import.templateDownloaded', { name: 'playforge-customers-template.xlsx' }));
      return;
    }
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
    this.downloadMessage.set(this.i18n.t('import.templateDownloaded', { name: 'playforge-template.xlsx' }));
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
    this.customerApplied.set(null);
    this.settingsApplied.set(null);
    this.errorMessage.set(null);
    this.preview.set(null);
    this.customerPreview.set(null);
    this.result.set(null);
    this.customerResult.set(null);
    this.settingsResult.set(null);
    this.settingsSectionSelected.set({});
    try {
      if (this.importTarget() === 'settings') {
        const res = await this.appSettings.validate(file);
        this.settingsResult.set(res);
        // Default: every valid section is selected.
        const sel: Record<string, boolean> = {};
        for (const k of res.validSections) sel[k] = true;
        this.settingsSectionSelected.set(sel);
      } else if (this.importTarget() === 'customers') {
        const res = await this.excel.importCustomersFromFile(file);
        this.customerResult.set(res);
        if (res.valid.length > 0) {
          this.customerPreview.set(this.excel.generateCustomerPreview(res.valid, this.importMode()));
        }
      } else {
        const res = await this.excel.importFromFile(file);
        this.result.set(res);
        if (res.valid.length > 0) {
          this.preview.set(this.excel.generatePreview(res.valid, this.importMode()));
        }
      }
    } catch (err) {
      console.error(err);
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to read the file.',
      );
    } finally {
      this.isParsing.set(false);
    }
  }

  async applyImport(): Promise<void> {
    if (this.importTarget() === 'settings') {
      const r = this.settingsResult();
      if (!r?.bundle) return;
      const sel = this.settingsSectionSelected();
      const sections = r.validSections.filter((k) => sel[k] !== false);
      if (sections.length === 0) return;
      const result = await this.appSettings.apply(r.bundle, sections);
      this.settingsApplied.set(result);
      return;
    }
    if (this.importTarget() === 'customers') {
      const p = this.customerPreview();
      if (!p) return;
      const selectedDrafts = p.rows.filter((r) => r.selected).map((r) => r.draft as ImportedCustomerDraft);
      if (selectedDrafts.length === 0) return;
      const summary = await this.excel.applyCustomerDrafts(selectedDrafts, this.importMode());
      this.customerApplied.set(summary);
      return;
    }
    const p = this.preview();
    if (!p) return;
    const selectedDrafts = p.rows.filter((r) => r.selected).map((r) => r.draft as ImportedProductDraft);
    if (selectedDrafts.length === 0) return;
    const summary = await this.excel.applyDrafts(selectedDrafts, this.importMode());
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
    this.customerResult.set(null);
    this.customerPreview.set(null);
    this.customerApplied.set(null);
    this.settingsResult.set(null);
    this.settingsApplied.set(null);
    this.settingsSectionSelected.set({});
    this.errorMessage.set(null);
    this.downloadMessage.set(null);
  }

  // ---- App-settings import helpers ----

  toggleSection(section: string): void {
    this.settingsSectionSelected.update((sel) => ({ ...sel, [section]: !(sel[section] !== false) }));
  }

  isSectionSelected(section: string): boolean {
    return this.settingsSectionSelected()[section] !== false;
  }

  sectionLabel(section: string): string {
    const map: Record<string, string> = {
      receiptLayout: this.i18n.t('import.settingsSectionReceiptLayout'),
      invoiceDefaults: this.i18n.t('import.settingsSectionInvoiceDefaults'),
      currency: this.i18n.t('import.settingsSectionCurrency'),
      favorites: this.i18n.t('import.settingsSectionFavorites'),
    };
    return map[section] ?? section;
  }

  sectionErrorLabel(section: string): string {
    const map: Record<string, string> = {
      bundle: this.i18n.t('import.settingsSectionBundle'),
      receiptLayout: this.i18n.t('import.settingsSectionReceiptLayout'),
      invoiceDefaults: this.i18n.t('import.settingsSectionInvoiceDefaults'),
      currency: this.i18n.t('import.settingsSectionCurrency'),
      favorites: this.i18n.t('import.settingsSectionFavorites'),
    };
    return map[section] ?? section;
  }

  // Preview row display helpers that work for both catalog and customer rows
  previewRowName(row: ImportPreviewRow): string {
    const d = row.draft;
    if ('familyName' in d) return (d).familyName;
    if ('name' in d) return (d).name;
    return '';
  }

  previewRowMeta(row: ImportPreviewRow): string {
    const d = row.draft;
    if ('familyCode' in d) {
      const pd = d;
      let meta = `${pd.familyCode} · ${pd.variantSku}`;
      if (pd.size) meta += ` · ${pd.size}`;
      meta += ` · ${pd.price} ${pd.currency}`;
      return meta;
    }
    if ('email' in d) {
      const cd = d;
      return cd.email || cd.phone || cd.taxId || '';
    }
    return '';
  }

  conflictLabel(conflict: string): string {
    const map: Record<string, string> = {
      duplicate_code_in_file: this.i18n.t('import.conflictDuplicateCode'),
      duplicate_sku_in_file: this.i18n.t('import.conflictDuplicateSku'),
      duplicate_name_in_file: this.i18n.t('import.conflictDuplicateName'),
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
      'create-customer': this.i18n.t('import.actionCreateCustomer'),
      'update-customer': this.i18n.t('import.actionUpdateCustomer'),
    };
    return map[action] ?? action;
  }
}
