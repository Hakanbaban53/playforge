import { Component, inject, signal, DestroyRef } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { CdkDragDrop, CdkDrag, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { ReceiptLayoutService } from '../../core/services/receipt-layout.service';
import { InvoiceService } from '../../core/services/invoice.service';
import { I18nService } from '../../core/services/i18n.service';
import { UploadService } from '../../core/services/upload.service';
import { ImageResolverService } from '../../core/services/image-resolver.service';
import { LayoutElement, LayoutElementType, ReceiptStyles } from '../../core/models/receipt.model';
import { IconComponent } from '../../shared/components/icon.component';
import { ButtonComponent } from '../../shared/components/button.component';
import { ResolvedImgComponent } from '../../shared/components/resolved-img.component';
import { ConfirmService } from '../../core/services/confirm.service';
import { ReceiptPreviewComponent } from '../../shared/components/receipt-preview.component';
import {
  parseImageSources,
  getStyleValue,
} from '../../core/utils/receipt-utils';

/**
 * Receipt layout editor — drag-drop reorder, add text/image/divider/totals
 * blocks, edit per-element styles (including a font-size stepper for
 * arbitrary px values), toggle visibility, and persist the layout.
 *
 * The live preview on the right renders every visible element from the
 * layout — **including** the totals block, which is now a first-class
 * draggable element rather than a hardcoded piece outside the editable area.
 *
 * Image uploads go through `UploadService` → `/api/upload` → stable URL on
 * the server. No more data URIs in localStorage (which broke PDF rendering).
 */
@Component({
  selector: 'app-receipt-editor-page',
  standalone: true,
  imports: [
    IconComponent,
    ButtonComponent,
    TranslatePipe,
    ResolvedImgComponent,
    ReceiptPreviewComponent,
    CdkDropList,
    CdkDrag,
  ],
  templateUrl: './receipt-editor-page.html',
  styleUrl: './receipt-editor-page.scss',
})
export class ReceiptEditorPage {
  private readonly layoutService = inject(ReceiptLayoutService);
  private readonly invoice = inject(InvoiceService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly uploadService = inject(UploadService);
  private readonly imageResolver = inject(ImageResolverService);
  private readonly confirmSvc = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);

  readonly layout = this.layoutService.layout;
  readonly active = this.invoice.active;

  /** Track which element is currently selected for editing (its id). */
  readonly selectedId = signal<string | null>(null);

  /** Per-element upload-in-flight flag (keyed by element id). */
  readonly uploadingFor = signal<string | null>(null);
  readonly uploadError = signal<string | null>(null);

  // Style picker options
  readonly textWeights = [
    { value: '400', key: 'receipt.regular' },
    { value: '600', key: 'receipt.semiBold' },
    { value: '700', key: 'receipt.bold' },
  ];
  readonly textAlignments = [
    { value: 'left', key: 'receipt.left' },
    { value: 'center', key: 'receipt.center' },
    { value: 'right', key: 'receipt.right' },
  ];
  readonly imageFits = [
    { value: 'contain', key: 'receipt.contain' },
    { value: 'cover', key: 'receipt.cover' },
  ];
  readonly imagePerRowOptions = ['1', '2', '3', '4'];

  // ---- Mutations ----

  onDrop(event: CdkDragDrop<LayoutElement[]>): void {
    const current = [...this.layout()];
    moveItemInArray(current, event.previousIndex, event.currentIndex);
    this.layoutService.reorder(current);
  }

  selectElement(id: string): void {
    this.selectedId.set(id);
    this.uploadError.set(null);
  }

  toggleVisibility(id: string): void {
    this.layoutService.toggleVisibility(id);
  }

  removeElement(id: string): void {
    if (!this.layoutService.removeElement(id)) return;
    if (this.selectedId() === id) this.selectedId.set(null);
  }

  addElement(type: LayoutElementType): void {
    const id = this.layoutService.addElement(type);
    this.selectedId.set(id);
  }

  updateContent(id: string, event: Event): void {
    const value = (event.target as HTMLTextAreaElement | HTMLInputElement).value;
    this.layoutService.updateElement(id, { content: value });
  }

  updateStyle(id: string, key: keyof ReceiptStyles, event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    const value = target.value;
    this.layoutService.updateStyle(id, key, value);
  }

  /** Toggle a boolean-ish style (italic / underline) from a checkbox. */
  toggleStyle(id: string, key: 'fontStyle' | 'textDecoration', onValue: string, offValue: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.layoutService.updateStyle(id, key, checked ? onValue : offValue);
  }

  /**
   * Font size stepper — increments or decrements the current font size by
   * `step` pixels. Allows arbitrary px values, not just preset choices.
   */
  bumpFontSize(el: LayoutElement, step: number): void {
    const current = this.parsePx(el.styles?.fontSize, el.type === 'header' ? 20 : 14);
    const next = Math.max(8, Math.min(96, current + step));
    this.layoutService.updateStyle(el.id, 'fontSize', `${next}px`);
  }

  async resetLayout(): Promise<void> {
    if (!await this.confirmSvc.confirm(this.i18n.t('common.confirm'), 'Reset layout')) return;
    this.layoutService.resetToDefault();
    this.selectedId.set(null);
  }

  goBack(): void {
    void this.router.navigate(['/invoice']);
  }

  // ---- Helpers used by the template ----

  isRemovable(el: LayoutElement): boolean {
    return this.layoutService.isRemovable(el);
  }

  isContentEditable(el: LayoutElement): boolean {
    return this.layoutService.isContentEditable(el);
  }

  isTextStylable(el: LayoutElement): boolean {
    return this.layoutService.isTextStylable(el);
  }

  isImageStylable(el: LayoutElement): boolean {
    return this.layoutService.isImageStylable(el);
  }

  /** Map a layout element type to a Material Symbol icon name. */
  elementIcon(type: LayoutElementType): string {
    switch (type) {
      case 'header': return 'description';
      case 'table': return 'table_chart';
      case 'meta': return 'info';
      case 'totals': return 'calculate';
      case 'visuals': return 'image';
      case 'text': return 'text_snippet';
      case 'image': return 'image';
      case 'divider': return 'remove';
      default: return 'help';
    }
  }

  getStyle(el: LayoutElement, key: keyof ReceiptStyles, fallback: string): string {
    return getStyleValue(el, key, fallback);
  }

  /** Parse an image element's content into a list of URLs. */
  imageSources(el: LayoutElement): string[] {
    return parseImageSources(el.content);
  }

  /**
   * Upload image files via the FileStorageAdapter and append the returned
   * stable URLs to the element's content.
   */
  async onImageUpload(el: LayoutElement, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;

    this.uploadingFor.set(el.id);
    this.uploadError.set(null);
    try {
      const fileArray = Array.from(files);
      const uploaded = await this.uploadService.uploadMany(fileArray);
      const urls = uploaded.map((u) => u.url);
      const existing = el.content?.trim() ?? '';
      const merged = existing ? `${existing}\n${urls.join('\n')}` : urls.join('\n');
      this.layoutService.updateElement(el.id, { content: merged });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed.';
      this.uploadError.set(msg);
      console.error('Image upload failed:', err);
    } finally {
      this.uploadingFor.set(null);
      input.value = '';
    }
  }

  /** Remove a single image URL from an image element's content. */
  removeImage(el: LayoutElement, index: number): void {
    const sources = this.imageSources(el);
    sources.splice(index, 1);
    this.layoutService.updateElement(el.id, { content: sources.join('\n') });
  }

  private parsePx(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const m = /^(\d+(?:\.\d+)?)px$/.exec(value);
    return m ? Number(m[1]) : fallback;
  }
}
