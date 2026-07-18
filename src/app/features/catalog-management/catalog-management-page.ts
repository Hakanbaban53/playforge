import { Component, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { CatalogService } from '../../core/services/catalog.service';
import { I18nService } from '../../core/services/i18n.service';
import { UploadService } from '../../core/services/upload.service';
import { ConfirmService } from '../../core/services/confirm.service';
import {
  Part,
  PartCategory,
  ProductCategory,
  ProductFamily,
  ProductVariant,
} from '../../core/models/catalog.model';
import { IconComponent } from '../../shared/components/icon.component';
import { ButtonComponent } from '../../shared/components/button.component';
import { MoneyPipe } from '../../shared/pipes/money.pipe';

type DraftMode = 'none' | 'family' | 'variant' | 'part';

/**
 * Catalog management — CRUD UI for families, variants, and parts.
 *
 * Three-pane layout:
 *   1. Families list (left) — pick a family to edit
 *   2. Selected family editor (middle) — family details + variants + parts
 *   3. Modal-less inline editors for variants and parts
 *
 * No dialogs — everything is inline for a fast, signal-driven flow.
 */
@Component({
  selector: 'app-catalog-management-page',
  standalone: true,
  imports: [IconComponent, ButtonComponent, MoneyPipe, TranslatePipe],
  templateUrl: './catalog-management-page.html',
  styleUrl: './catalog-management-page.scss',
})
export class CatalogManagementPage {
  private readonly catalog = inject(CatalogService);
  private readonly i18n = inject(I18nService);
  private readonly uploadService = inject(UploadService);
  private readonly confirmSvc = inject(ConfirmService);

  readonly families = this.catalog.families;
  readonly variantsByFamily = this.catalog.variantsByFamily;
  readonly familyById = this.catalog.familyById;

  /** True while an image upload is in-flight (shows a spinner). */
  readonly isUploading = signal(false);
  readonly uploadError = signal<string | null>(null);

  /** Selected family id. */
  readonly selectedFamilyId = signal<string | null>(null);

  readonly selectedFamily = computed<ProductFamily | null>(() => {
    const id = this.selectedFamilyId();
    return id ? (this.familyById().get(id) ?? null) : null;
  });

  readonly variants = computed<ProductVariant[]>(() => {
    const id = this.selectedFamilyId();
    return id ? (this.variantsByFamily().get(id) ?? []) : [];
  });

  /** Draft editor state. */
  readonly draftMode = signal<DraftMode>('none');
  readonly editingId = signal<string | null>(null);

  // Form fields (kept as signals for simplicity; not using reactive forms)
  readonly fName = signal('');
  readonly fCode = signal('');
  readonly fCategory = signal<ProductCategory>('slide');
  readonly fDescription = signal('');
  readonly fAgeRange = signal('');
  readonly fCurrency = signal('USD');
  readonly fTags = signal('');
  readonly fImages = signal('');

  readonly fVariantLabel = signal('');
  readonly fVariantSku = signal('');
  readonly fVariantSize = signal('');
  readonly fVariantPrice = signal(0);
  readonly fVariantActive = signal(true);

  readonly fPartName = signal('');
  readonly fPartSku = signal('');
  readonly fPartCategory = signal<PartCategory>('structure');
  readonly fPartPrice = signal(0);
  readonly fPartRequired = signal(false);
  readonly fPartDesc = signal('');

  readonly productCategories: ProductCategory[] = [
    'slide', 'swing', 'climbing', 'merry-go-round', 'seesaw',
    'sandbox', 'playhouse', 'combo', 'accessory',
  ];

  readonly partCategories: PartCategory[] = [
    'structure', 'slide', 'climb', 'swing', 'roof',
    'safety', 'decoration', 'foundation',
  ];

  readonly error = signal<string | null>(null);

  /** IDs of variants/parts/families currently playing their exit animation.
   *  Kept in the DOM until the animation completes, then the underlying
   *  service actually removes the record. */
  readonly leavingVariantIds = signal<ReadonlySet<string>>(new Set());
  readonly leavingPartIds = signal<ReadonlySet<string>>(new Set());
  readonly leavingFamilyIds = signal<ReadonlySet<string>>(new Set());

  // ---- Selection ----

  selectFamily(id: string): void {
    this.selectedFamilyId.set(id);
    this.cancelDraft();
  }

  // ---- Family CRUD ----

  startAddFamily(): void {
    this.draftMode.set('family');
    this.editingId.set(null);
    this.fName.set('');
    this.fCode.set('');
    this.fCategory.set('slide');
    this.fDescription.set('');
    this.fAgeRange.set('');
    this.fCurrency.set('USD');
    this.fTags.set('');
    this.fImages.set('');
    this.error.set(null);
  }

  startEditFamily(f: ProductFamily): void {
    this.draftMode.set('family');
    this.editingId.set(f.id);
    this.fName.set(f.name);
    this.fCode.set(f.code);
    this.fCategory.set(f.category);
    this.fDescription.set(f.description);
    this.fAgeRange.set(f.ageRange ?? '');
    this.fCurrency.set(f.currency);
    this.fTags.set(f.tags.join(', '));
    this.fImages.set(f.images.map((i) => i.url).join('\n'));
    this.error.set(null);
  }

  async saveFamily(): Promise<void> {
    const name = this.fName().trim();
    const code = this.fCode().trim();
    if (!name) { this.error.set(this.i18n.t('catalogMgmt.nameRequired')); return; }
    if (!code) { this.error.set(this.i18n.t('catalogMgmt.codeRequired')); return; }

    const existing = this.families().find(
      (f) => f.code.toLowerCase() === code.toLowerCase() && f.id !== this.editingId(),
    );
    if (existing) { this.error.set(this.i18n.t('catalogMgmt.duplicateCode')); return; }

    const images = this.fImages()
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((url, idx) => ({
        id: `img-${Date.now()}-${idx}`,
        url,
        isPrimary: idx === 0,
        alt: '',
      }));

    const tags = this.fTags()
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    if (this.editingId()) {
      await this.catalog.updateFamily(this.editingId()!, {
        name, code, category: this.fCategory(),
        description: this.fDescription(),
        ageRange: this.fAgeRange() || undefined,
        currency: this.fCurrency(),
        tags, images,
      });
    } else {
      const created = await this.catalog.addFamily({
        name, code, category: this.fCategory(),
        description: this.fDescription(),
        ageRange: this.fAgeRange() || undefined,
        currency: this.fCurrency(),
        tags, images,
        availableParts: [],
      });
      this.selectedFamilyId.set(created.id);
    }
    this.cancelDraft();
  }

  async deleteFamily(f: ProductFamily): Promise<void> {
    if (!await this.confirmSvc.confirm(this.i18n.t('catalogMgmt.deleteFamilyConfirm', { name: f.name }), 'Delete family')) return;
    this.leavingFamilyIds.update((s) => new Set(s).add(f.id));
    window.setTimeout(async () => {
      if (this.selectedFamilyId() === f.id) this.selectedFamilyId.set(null);
      await this.catalog.removeFamily(f.id);
      this.leavingFamilyIds.update((s) => {
        const next = new Set(s);
        next.delete(f.id);
        return next;
      });
    }, 200);
  }

  // ---- Variant CRUD ----

  startAddVariant(): void {
    if (!this.selectedFamilyId()) return;
    this.draftMode.set('variant');
    this.editingId.set(null);
    this.fVariantLabel.set('');
    this.fVariantSku.set('');
    this.fVariantSize.set('');
    this.fVariantPrice.set(0);
    this.fVariantActive.set(true);
    this.error.set(null);
  }

  startEditVariant(v: ProductVariant): void {
    this.draftMode.set('variant');
    this.editingId.set(v.id);
    this.fVariantLabel.set(v.label);
    this.fVariantSku.set(v.sku);
    this.fVariantActive.set(v.active);
    const sizeOv = v.overrides.find((o) => o.key === 'size');
    const priceOv = v.overrides.find((o) => o.key === 'price');
    this.fVariantSize.set(sizeOv?.value ?? '');
    this.fVariantPrice.set(priceOv?.value ?? 0);
    this.error.set(null);
  }

  async saveVariant(): Promise<void> {
    const familyId = this.selectedFamilyId();
    if (!familyId) return;
    const label = this.fVariantLabel().trim();
    const sku = this.fVariantSku().trim();
    if (!label) { this.error.set(this.i18n.t('catalogMgmt.nameRequired')); return; }
    if (!sku) { this.error.set(this.i18n.t('catalogMgmt.skuRequired')); return; }

    // Duplicate SKU check within family
    const fam = this.familyById().get(familyId);
    if (!fam) return;
    const allVariants = this.variantsByFamily().get(familyId) ?? [];
    const dupSku = allVariants.find(
      (v) => v.sku.toLowerCase() === sku.toLowerCase() && v.id !== this.editingId(),
    );
    if (dupSku) { this.error.set(this.i18n.t('catalogMgmt.duplicateSku')); return; }

    const overrides: ProductVariant['overrides'] = [];
    if (this.fVariantSize().trim()) {
      overrides.push({ key: 'size', value: this.fVariantSize().trim() });
    }
    overrides.push({ key: 'price', value: this.fVariantPrice() });

    if (this.editingId()) {
      await this.catalog.updateVariant(this.editingId()!, {
        label, sku, active: this.fVariantActive(), overrides,
      });
    } else {
      await this.catalog.addVariant({
        familyId, label, sku, active: this.fVariantActive(), overrides,
      });
    }
    this.cancelDraft();
  }

  async deleteVariant(v: ProductVariant): Promise<void> {
    if (!await this.confirmSvc.confirm(this.i18n.t('catalogMgmt.deleteVariantConfirm', { sku: v.sku }), 'Delete variant')) return;
    this.leavingVariantIds.update((s) => new Set(s).add(v.id));
    window.setTimeout(async () => {
      await this.catalog.removeVariant(v.id);
      this.leavingVariantIds.update((s) => {
        const next = new Set(s);
        next.delete(v.id);
        return next;
      });
    }, 200);
  }

  // ---- Part CRUD ----

  startAddPart(): void {
    if (!this.selectedFamilyId()) return;
    this.draftMode.set('part');
    this.editingId.set(null);
    this.fPartName.set('');
    this.fPartSku.set('');
    this.fPartCategory.set('structure');
    this.fPartPrice.set(0);
    this.fPartRequired.set(false);
    this.fPartDesc.set('');
    this.error.set(null);
  }

  startEditPart(p: Part): void {
    this.draftMode.set('part');
    this.editingId.set(p.id);
    this.fPartName.set(p.name);
    this.fPartSku.set(p.sku);
    this.fPartCategory.set(p.category);
    this.fPartPrice.set(p.price);
    this.fPartRequired.set(p.required ?? false);
    this.fPartDesc.set(p.description ?? '');
    this.error.set(null);
  }

  async savePart(): Promise<void> {
    const familyId = this.selectedFamilyId();
    if (!familyId) return;
    const fam = this.familyById().get(familyId);
    if (!fam) return;

    const name = this.fPartName().trim();
    const sku = this.fPartSku().trim();
    if (!name) { this.error.set(this.i18n.t('catalogMgmt.nameRequired')); return; }
    if (!sku) { this.error.set(this.i18n.t('catalogMgmt.skuRequired')); return; }
    if (this.fPartPrice() < 0) { this.error.set(this.i18n.t('catalogMgmt.priceRequired')); return; }

    // Duplicate part SKU within family
    const dupSku = fam.availableParts.find(
      (p) => p.sku.toLowerCase() === sku.toLowerCase() && p.id !== this.editingId(),
    );
    if (dupSku) { this.error.set(this.i18n.t('catalogMgmt.duplicateSku')); return; }

    const part: Part = {
      id: this.editingId() ?? `pt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name, sku,
      category: this.fPartCategory(),
      price: this.fPartPrice(),
      description: this.fPartDesc() || undefined,
      required: this.fPartRequired(),
    };

    const newParts = this.editingId()
      ? fam.availableParts.map((p) => (p.id === this.editingId() ? part : p))
      : [...fam.availableParts, part];

    await this.catalog.updateFamily(familyId, { availableParts: newParts });
    this.cancelDraft();
  }

  async deletePart(p: Part): Promise<void> {
    const familyId = this.selectedFamilyId();
    if (!familyId) return;
    const fam = this.familyById().get(familyId);
    if (!fam) return;
    if (!await this.confirmSvc.confirm(this.i18n.t('catalogMgmt.deletePartConfirm', { name: p.name }), 'Delete part')) return;
    this.leavingPartIds.update((s) => new Set(s).add(p.id));
    window.setTimeout(async () => {
      const current = this.familyById().get(familyId);
      if (current) {
        const newParts = current.availableParts.filter((x) => x.id !== p.id);
        await this.catalog.updateFamily(familyId, { availableParts: newParts });
      }
      this.leavingPartIds.update((s) => {
        const next = new Set(s);
        next.delete(p.id);
        return next;
      });
    }, 200);
  }

  // ---- Helpers ----

  cancelDraft(): void {
    this.draftMode.set('none');
    this.editingId.set(null);
    this.error.set(null);
  }

  /** Update a signal from an input event (one-liner for templates). */
  set(target: { set: (v: string) => void }, event: Event): void {
    target.set((event.target as HTMLInputElement | HTMLTextAreaElement).value);
  }

  setNum(target: { set: (v: number) => void }, event: Event): void {
    const v = Number((event.target as HTMLInputElement).value);
    target.set(Number.isFinite(v) ? v : 0);
  }

  setBool(target: { set: (v: boolean) => void }, event: Event): void {
    target.set((event.target as HTMLInputElement).checked ?? false);
  }

  /** Set a typed-enum signal from a select event. */
  setProductCategory(event: Event): void {
    this.fCategory.set((event.target as HTMLSelectElement).value as ProductCategory);
  }
  setPartCategory(event: Event): void {
    this.fPartCategory.set((event.target as HTMLSelectElement).value as PartCategory);
  }
  setCurrency(event: Event): void {
    this.fCurrency.set((event.target as HTMLSelectElement).value);
  }

  variantPrice(v: ProductVariant): number {
    const priceOv = v.overrides.find((o) => o.key === 'price');
    if (priceOv) return priceOv.value;
    return this.familyById().get(v.familyId)?.availableParts.reduce((sum, p) => sum + p.price, 0) ?? 0;
  }

  variantSize(v: ProductVariant): string {
    return v.overrides.find((o) => o.key === 'size')?.value ?? '—';
  }

  async onImageUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;

    this.isUploading.set(true);
    this.uploadError.set(null);
    try {
      const uploaded = await this.uploadService.uploadMany(Array.from(files));
      const urls = uploaded.map((u) => u.url);
      const existing = this.fImages().trim();
      const merged = existing ? `${existing}\n${urls.join('\n')}` : urls.join('\n');
      this.fImages.set(merged);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed.';
      this.uploadError.set(msg);
      console.error('Image upload failed:', err);
    } finally {
      this.isUploading.set(false);
      input.value = '';
    }
  }
}
