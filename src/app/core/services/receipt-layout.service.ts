import { Injectable, inject, signal } from '@angular/core';
import { StorageService } from './storage.service';
import { I18nService } from './i18n.service';
import {
  buildDefaultLayout,
  DEFAULT_HEADER_STYLES,
  DEFAULT_IMAGE_STYLES,
  DEFAULT_TEXT_STYLES,
  LayoutElement,
  LayoutElementType,
  ReceiptStyles,
} from '../models/receipt.model';

const STORAGE_KEY = 'receipt:layout';

/**
 * Receipt layout service — manages the user-editable list of
 * `LayoutElement`s that define how the customer-facing receipt is laid out.
 *
 * The layout is persisted in localStorage so changes survive page reloads.
 * Fixed elements (header, table, meta, visuals) cannot be removed — they
 * carry invoice-derived content — but their styles and visibility can be
 * tweaked. User-added text / image / divider elements are fully editable
 * and removable.
 *
 * The renderer (ReceiptRendererComponent) reads this layout and produces
 * the actual HTML, which the PDF service then snapshots.
 */
@Injectable({ providedIn: 'root' })
export class ReceiptLayoutService {
  private readonly storage = inject(StorageService);
  private readonly i18n = inject(I18nService);

  private readonly _layout = signal<LayoutElement[]>(this.loadLayout());
  readonly layout = this._layout.asReadonly();

  /** Reorder the layout in-place (used by CDK drag-drop). */
  reorder(newOrder: LayoutElement[]): void {
    const numbered = newOrder.map((el) => ({ ...el }));
    this._layout.set(numbered);
    this.persist();
  }

  /** Replace the entire layout (used by settings import). */
  replaceAll(layout: LayoutElement[]): void {
    const normalized = this.normalize(layout);
    this._layout.set(normalized);
    this.persist();
  }

  /** Update an element by id with a partial patch. */
  updateElement(id: string, patch: Partial<LayoutElement>): void {
    this._layout.update((list) =>
      list.map((el) => (el.id === id ? { ...el, ...patch } : el)),
    );
    this.persist();
  }

  /** Toggle visibility of an element. */
  toggleVisibility(id: string): void {
    this._layout.update((list) =>
      list.map((el) =>
        el.id === id ? { ...el, visible: !el.visible } : el,
      ),
    );
    this.persist();
  }

  /** Remove an element by id. Fixed elements cannot be removed. */
  removeElement(id: string): boolean {
    const el = this._layout().find((e) => e.id === id);
    if (!el || el.fixed) return false;
    this._layout.update((list) => list.filter((e) => e.id !== id));
    this.persist();
    return true;
  }

  /** Add a new user element of the given type. Returns the new element's id. */
  addElement(type: LayoutElementType): string {
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
    this._layout.update((list) => [...list, newEl]);
    this.persist();
    return id;
  }

  /** Update a style key on an element. */
  updateStyle(id: string, key: keyof ReceiptStyles, value: string): void {
    this._layout.update((list) =>
      list.map((el) => {
        if (el.id !== id) return el;
        const nextStyles: ReceiptStyles = { ...(el.styles ?? {}), [key]: value };
        // Normalize empty string to deletion.
        if (value === '' || value == null) {
          delete (nextStyles as Record<string, unknown>)[key as string];
        }
        return { ...el, styles: nextStyles };
      }),
    );
    this.persist();
  }

  /** Replace the layout with the default. */
  resetToDefault(): void {
    const fresh = buildDefaultLayout(
      'receipt.defaultHeader',
      'receipt.defaultTerms',
    );
    this._layout.set(fresh);
    this.persist();
  }

  /** True if the element can be removed (not fixed). */
  isRemovable(el: LayoutElement): boolean {
    return !el.fixed;
  }

  /** True if the element's content can be edited (text / image / header). */
  isContentEditable(el: LayoutElement): boolean {
    return el.type === 'header' || el.type === 'text' || el.type === 'image';
  }

  /** True if the element supports text styling. */
  isTextStylable(el: LayoutElement): boolean {
    return el.type === 'header' || el.type === 'text' || el.type === 'notes';
  }

  /** True if the element supports image styling. */
  isImageStylable(el: LayoutElement): boolean {
    return el.type === 'image' || el.type === 'visuals';
  }

  // ---- internals ----

  private loadLayout(): LayoutElement[] {
    const stored = this.storage.read<LayoutElement[] | null>(STORAGE_KEY, null);
    if (stored && Array.isArray(stored) && stored.length > 0) {
      const normalized = this.normalize(stored);
      if (!normalized.some((el) => el.type === 'notes')) {
        const notesEl: LayoutElement = {
          id: 'notes',
          type: 'notes',
          visible: true,
          fixed: true,
          labelKey: 'receipt.elements.notes',
          styles: { ...DEFAULT_TEXT_STYLES },
        };
        const totalsIdx = normalized.findIndex((el) => el.type === 'totals');
        if (totalsIdx >= 0) {
          normalized.splice(totalsIdx + 1, 0, notesEl);
        } else {
          normalized.push(notesEl);
        }
        this.storage.write(STORAGE_KEY, normalized);
      }
      return normalized;
    }
    const fresh = buildDefaultLayout('receipt.defaultHeader', 'receipt.defaultTerms');
    // Persist the defaults so the storage key is always populated.
    this.storage.write(STORAGE_KEY, fresh);
    return fresh;
  }

  private persist(): void {
    this.storage.write(STORAGE_KEY, this._layout());
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
