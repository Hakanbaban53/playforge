import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { CdkDragDrop, CdkDrag, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { ReceiptLayoutService } from '../../core/services/receipt-layout.service';
import { InvoiceService } from '../../core/services/invoice.service';
import { I18nService } from '../../core/services/i18n.service';
import { UploadService } from '../../core/services/upload.service';
import { ToastService } from '../../core/services/toast.service';
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
 * blocks, edit per-element styles, toggle visibility, and persist the layout.
 *
 * The live preview renders every visible element from the layout (including
 * the totals block, which is a first-class draggable element).
 *
 * Image uploads go through `UploadService` → `FileStorageAdapter` → stable
 * `idb://` URL (browser) or `asset://` URL (Tauri).
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
  private readonly confirmSvc = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  readonly layout = this.layoutService.layout;
  readonly active = this.invoice.active;

  readonly selectedId = signal<string | null>(null);

  readonly leavingIds = signal<ReadonlySet<string>>(new Set());

  readonly uploadingFor = signal<string | null>(null);
  readonly uploadError = signal<string | null>(null);

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
  onDrop(event: CdkDragDrop<LayoutElement[]>): void {
    const current = [...this.layout()];
    moveItemInArray(current, event.previousIndex, event.currentIndex);
    void this.layoutService.reorder(current);
  }

  selectElement(id: string): void {
    this.selectedId.set(id);
    this.uploadError.set(null);
  }

  toggleVisibility(id: string): void {
    void this.layoutService.toggleVisibility(id);
  }

  removeElement(id: string): void {
    if (!this.layoutService.isRemovableById(id)) return;
    this.leavingIds.update((s) => new Set(s).add(id));
    if (this.selectedId() === id) this.selectedId.set(null);
    window.setTimeout(() => {
      void this.layoutService.removeElement(id);
      this.leavingIds.update((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }, 180);
  }

  async addElement(type: LayoutElementType): Promise<void> {
    const id = await this.layoutService.addElement(type);
    this.selectedId.set(id);
  }

  updateContent(id: string, event: Event): void {
    const value = (event.target as HTMLTextAreaElement | HTMLInputElement).value;
    void this.layoutService.updateElement(id, { content: value });
  }

  updateStyle(id: string, key: keyof ReceiptStyles, event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    const value = target.value;
    void this.layoutService.updateStyle(id, key, value);
  }

  toggleStyle(id: string, key: 'fontStyle' | 'textDecoration', onValue: string, offValue: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    void this.layoutService.updateStyle(id, key, checked ? onValue : offValue);
  }

  bumpFontSize(el: LayoutElement, step: number): void {
    const current = this.parsePx(el.styles?.fontSize, el.type === 'header' ? 20 : 14);
    const next = Math.max(8, Math.min(96, current + step));
    void this.layoutService.updateStyle(el.id, 'fontSize', `${next}px`);
  }

  async resetLayout(): Promise<void> {
    if (!await this.confirmSvc.confirm(this.i18n.t('common.confirm'), 'Reset layout')) return;
    await this.layoutService.resetToDefault();
    this.selectedId.set(null);
    this.toast.info('toast.layoutReset');
  }

  goBack(): void {
    void this.router.navigate(['/invoice']);
  }
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

  elementIcon(type: LayoutElementType): string {
    switch (type) {
      case 'header': return 'description';
      case 'table': return 'table_chart';
      case 'meta': return 'info';
      case 'totals': return 'calculate';
      case 'notes': return 'sticky_note_2';
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

  imageSources(el: LayoutElement): string[] {
    return parseImageSources(el.content);
  }


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
      await this.layoutService.updateElement(el.id, { content: merged });
      this.toast.success('toast.imageUploaded');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed.';
      this.uploadError.set(msg);
      this.toast.error('toast.imageUploadFailed');
      console.error('Image upload failed:', err);
    } finally {
      this.uploadingFor.set(null);
      input.value = '';
    }
  }

  removeImage(el: LayoutElement, index: number): void {
    const sources = this.imageSources(el);
    sources.splice(index, 1);
    void this.layoutService.updateElement(el.id, { content: sources.join('\n') });
  }

  private parsePx(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const m = /^(\d+(?:\.\d+)?)px$/.exec(value);
    return m ? Number(m[1]) : fallback;
  }
}
