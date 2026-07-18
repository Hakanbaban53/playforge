import { Injectable, inject, computed } from '@angular/core';
import { DataProvider, Collections } from './data-provider';
import { I18nService } from './i18n.service';
import { UploadService } from './upload.service';
import { parseImageSources } from '../utils/receipt-utils';
import {
  buildDefaultLayout,
  DEFAULT_HEADER_STYLES,
  DEFAULT_IMAGE_STYLES,
  DEFAULT_TEXT_STYLES,
  LayoutElement,
  LayoutElementType,
  ReceiptStyles,
} from '../models/receipt.model';

/**
 * Receipt layout service — manages the user-editable list of
 * `LayoutElement`s that define how the customer-facing receipt is laid out.
 *
 * The layout is persisted via `DataProvider` (single doc under
 * `receipt:layout`) so changes survive page reloads and sync across
 * devices when the user is signed in.
 *
 * Storage shape: The layout is stored as `{ elements: LayoutElement[] }`
 * (an object wrapping the array). Firestore's `setDoc` requires a
 * document (object), not a raw array — earlier versions stored the
 * array directly, which worked with localStorage but crashed Firestore.
 * The `layout` computed handles both shapes for backward compatibility
 * with existing localStorage data.
 *
 * Fixed elements (header, table, meta, visuals) cannot be removed — they
 * carry invoice-derived content — but their styles and visibility can be
 * tweaked. User-added text / image / divider elements are fully editable
 * and removable.
 */
interface StoredReceiptLayout {
  elements: LayoutElement[];
}

@Injectable({ providedIn: 'root' })
export class ReceiptLayoutService {
  private readonly data = inject(DataProvider);
  private readonly i18n = inject(I18nService);
  private readonly uploadService = inject(UploadService);

  /** Raw doc signal — may be `{ elements: [...] }` (new shape) or a raw
   *  `LayoutElement[]` (old localStorage shape, for backward compat). */
  private readonly docSignal = this.data.doc<StoredReceiptLayout | LayoutElement[]>(Collections.receiptLayout);

  /** Reactive layout — extracts the elements array from either storage
   *  shape, falls back to the default layout if empty. */
  readonly layout = computed<LayoutElement[]>(() => {
    const stored = this.docSignal();
    // Handle both shapes: new `{ elements: [...] }` and legacy raw array.
    const elements = Array.isArray(stored) ? stored : stored?.elements;
    if (elements && Array.isArray(elements) && elements.length > 0) {
      return this.normalize(elements);
    }
    return buildDefaultLayout('receipt.defaultHeader', 'receipt.defaultTerms');
  });

  /** Reorder the layout in-place (used by CDK drag-drop). */
  async reorder(newOrder: LayoutElement[]): Promise<void> {
    await this.data.setDoc<StoredReceiptLayout>(Collections.receiptLayout, {
      elements: newOrder.map((el) => ({ ...el })),
    });
  }

  /** Replace the entire layout (used by settings import). */
  async replaceAll(layout: LayoutElement[]): Promise<void> {
    await this.data.setDoc<StoredReceiptLayout>(Collections.receiptLayout, {
      elements: this.normalize(layout),
    });
  }

  /** Update an element by id with a partial patch. */
  async updateElement(id: string, patch: Partial<LayoutElement>): Promise<void> {
    const existing = this.layout().find((el) => el.id === id);
    if (existing && patch.content !== undefined && (existing.type === 'image' || existing.type === 'visuals')) {
      const oldUrls = parseImageSources(existing.content);
      const newUrls = new Set(parseImageSources(patch.content));
      const deletedUrls = oldUrls.filter((url) => !newUrls.has(url));
      await Promise.all(deletedUrls.map((url) => this.uploadService.delete(url)));
    }

    const next = this.layout().map((el) => (el.id === id ? { ...el, ...patch } : el));
    await this.data.setDoc<StoredReceiptLayout>(Collections.receiptLayout, { elements: next });
  }

  /** Toggle visibility of an element. */
  async toggleVisibility(id: string): Promise<void> {
    const next = this.layout().map((el) =>
      el.id === id ? { ...el, visible: !el.visible } : el,
    );
    await this.data.setDoc<StoredReceiptLayout>(Collections.receiptLayout, { elements: next });
  }

  /** Remove an element by id. Fixed elements cannot be removed. */
  async removeElement(id: string): Promise<boolean> {
    const el = this.layout().find((e) => e.id === id);
    if (!el || el.fixed) return false;

    if (el.type === 'image' || el.type === 'visuals') {
      const urls = parseImageSources(el.content);
      await Promise.all(urls.map((url) => this.uploadService.delete(url)));
    }

    const next = this.layout().filter((e) => e.id !== id);
    await this.data.setDoc<StoredReceiptLayout>(Collections.receiptLayout, { elements: next });
    return true;
  }

  /** Add a new user element of the given type. Returns the new element's id. */
  async addElement(type: LayoutElementType): Promise<string> {
    const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newEl: LayoutElement = {
      id,
      type,
      visible: true,
      labelKey: `receipt.elements.${type}`,
      content: type === 'text' ? this.i18n.t('receipt.defaultTerms') : '',
      styles:
        type === 'text'
          ? { ...DEFAULT_TEXT_STYLES }
          : type === 'image'
            ? { ...DEFAULT_IMAGE_STYLES }
            : undefined,
    };
    await this.data.setDoc<StoredReceiptLayout>(Collections.receiptLayout, {
      elements: [...this.layout(), newEl],
    });
    return id;
  }

  /** Update a style key on an element. */
  async updateStyle(id: string, key: keyof ReceiptStyles, value: string): Promise<void> {
    const next = this.layout().map((el) => {
      if (el.id !== id) return el;
      const nextStyles: ReceiptStyles = { ...(el.styles ?? {}), [key]: value };
      // Normalize empty string to deletion.
      if (value === '' || value == null) {
        delete (nextStyles as Record<string, unknown>)[key as string];
      }
      return { ...el, styles: nextStyles };
    });
    await this.data.setDoc<StoredReceiptLayout>(Collections.receiptLayout, { elements: next });
  }

  /** Replace the layout with the default. */
  async resetToDefault(): Promise<void> {
    const fresh = buildDefaultLayout('receipt.defaultHeader', 'receipt.defaultTerms');
    await this.data.setDoc<StoredReceiptLayout>(Collections.receiptLayout, { elements: fresh });
  }

  isRemovable(el: LayoutElement): boolean {
    return !el.fixed;
  }

  /** True if the element with the given id can be removed. Convenience
   *  wrapper around isRemovable(el) for callers that only have the id. */
  isRemovableById(id: string): boolean {
    const el = this.layout().find((e) => e.id === id);
    return !!el && !el.fixed;
  }

  isContentEditable(el: LayoutElement): boolean {
    return el.type === 'header' || el.type === 'text' || el.type === 'image';
  }

  isTextStylable(el: LayoutElement): boolean {
    return el.type === 'header' || el.type === 'text' || el.type === 'notes';
  }

  isImageStylable(el: LayoutElement): boolean {
    return el.type === 'image' || el.type === 'visuals';
  }
  /** Backfill missing styles with defaults — used when loading older layouts. */
  private normalize(items: LayoutElement[]): LayoutElement[] {
    return items.map((item) => {
      const next: LayoutElement = { ...item };
      const defaults =
        item.type === 'header'
          ? DEFAULT_HEADER_STYLES
          : item.type === 'text' || item.type === 'notes'
            ? DEFAULT_TEXT_STYLES
            : item.type === 'image'
              ? DEFAULT_IMAGE_STYLES
              : null;
      if (defaults) {
        next.styles = { ...defaults, ...(item.styles ?? {}) };
      }
      return next;
    });
  }
}
