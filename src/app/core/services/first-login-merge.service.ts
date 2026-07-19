import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { LocalDataProvider } from './local-data-provider';
import { DataProvider, Collections } from './data-provider';
import { AuthService } from './auth.service';
import { Customer } from '../models/customer.model';
import { ProductFamily, ProductVariant } from '../models/catalog.model';
import { Invoice } from '../models/invoice.model';
import { FileStorageAdapter, parseStoredFileRef } from './file-storage.adapter';
import { ImageSyncQueueService } from './image-sync-queue.service';
import { ImageMappingsService } from './image-mappings.service';
import { guessMimeType } from '../utils/mime';

/**
 * First-login merge service.
 *
 * When a user signs in for the first time on a device, they may have
 * anonymous local data (customers, invoices, catalog, etc.) that they
 * created before signing in. This service:
 *
 *   1. Detects that scenario (just-signed-in + local data exists + cloud
 *      data is empty).
 *   2. Surfaces a `shouldPrompt` signal that the UI binds to.
 *   3. When the user accepts, copies all local data into the (now-active)
 *      Firestore provider, then clears the local data so the device
 *      starts fresh.
 *   4. When the user declines, just dismisses the prompt — local data
 *      stays untouched (and will be overwritten by cloud data if the
 *      user later signs out and back in on the same device).
 *
 * Why this matters: without the merge prompt, signing in would either
 * (a) silently discard the user's local work, or (b) silently merge it
 * with cloud data and produce duplicates. The explicit prompt is the
 * only safe option.
 *
 * Counting: we read directly from LocalDataProvider's signals to count
 * records. We don't touch the active provider (which has already
 * swapped to Firestore by the time this runs).
 */
@Injectable({ providedIn: 'root' })
export class FirstLoginMergeService {
  private readonly local = inject(LocalDataProvider);
  private readonly activeProvider = inject(DataProvider);
  private readonly auth = inject(AuthService);
  private readonly fileStorage = inject(FileStorageAdapter);
  private readonly syncQueue = inject(ImageSyncQueueService);
  private readonly mappings = inject(ImageMappingsService);

  /** True while the merge is in progress (uploading local → cloud). */
  private readonly _merging = signal(false);
  readonly merging = this._merging.asReadonly();

  /** True if the user dismissed the prompt without merging. */
  private readonly _dismissed = signal(false);
  readonly dismissed = this._dismissed.asReadonly();

  /** Local data summary — used by the prompt UI. */
  readonly localSummary = computed(() => {
    // Reading from LocalDataProvider directly (NOT the active provider,
    // which may have already swapped to Firestore).
    const families = this.local.collection<ProductFamily>(Collections.catalogFamilies)();
    const variants = this.local.collection<ProductVariant>(Collections.catalogVariants)();
    const customers = this.local.collection<Customer>(Collections.customers)();
    const invoices = this.local.collection<Invoice>(Collections.invoiceSaved)();
    const favoritesDoc = this.local.doc<{ ids: string[] }>(Collections.favorites)();
    // Receipt layout may be stored as `{ elements: [...] }` (new shape)
    // or a raw `LayoutElement[]` (legacy localStorage shape). Handle both.
    const receiptLayoutRaw = this.local.doc<unknown>(Collections.receiptLayout)();
    const receiptLayoutElements = Array.isArray(receiptLayoutRaw)
      ? receiptLayoutRaw
      : (receiptLayoutRaw as { elements?: unknown[] } | null)?.elements;
    const invoiceDefaults = this.local.doc<unknown>(Collections.invoiceDefaults)();
    const currencyDoc = this.local.doc<{ rates: unknown; base: string }>(Collections.currencyRates)();

    return {
      families: families.length,
      variants: variants.length,
      customers: customers.length,
      invoices: invoices.length,
      favorites: favoritesDoc?.ids?.length ?? 0,
      hasReceiptLayout: !!receiptLayoutElements && receiptLayoutElements.length > 0,
      hasInvoiceDefaults: !!invoiceDefaults,
      hasCurrency: !!currencyDoc,
      totalRecords:
        families.length + variants.length + customers.length + invoices.length,
    };
  });

  /** True once the user has seen the merge prompt for the current
   *  sign-in session. Prevents re-showing after dismissal. Reset on
   *  sign-out. */
  private readonly _promptShown = signal(false);

  /** True if we should show the merge prompt.
   *
   *  The prompt is triggered by `justSignedIn()` (which is true for
   *  ~3 seconds after sign-in completes), but once shown, it stays
   *  visible until the user explicitly dismisses or completes the merge
   *  — NOT tied to the 3-second timeout. This prevents the popup from
   *  vanishing before the user can read it. */
  readonly shouldPrompt = computed(() => {
    if (!this.auth.isAuthenticated()) return false;
    if (this._dismissed()) return false;
    if (this._merging()) return false;

    // If the prompt was already shown (triggered by justSignedIn),
    // keep showing it until dismissed — don't hide it when the
    // justSignedIn flag expires.
    if (this._promptShown()) return true;

    // First-time trigger: only show when justSignedIn fires AND there's
    // local data to merge.
    if (!this.auth.justSignedIn()) return false;
    return this.localSummary().totalRecords > 0
      || this.localSummary().hasReceiptLayout
      || this.localSummary().hasInvoiceDefaults
      || this.localSummary().hasCurrency;
  });

  constructor() {
    // Latch the prompt as "shown" when shouldPrompt first becomes true,
    // so it stays visible after justSignedIn expires.
    effect(() => {
      if (this.shouldPrompt() && !this._promptShown()) {
        this._promptShown.set(true);
      }
    });

    // Reset both flags when the user signs out, so the next sign-in
    // can re-trigger the prompt.
    effect(() => {
      if (!this.auth.isAuthenticated()) {
        this._dismissed.set(false);
        this._promptShown.set(false);
      }
    });
  }

  /** Upload all local data into the active (cloud) provider, then clear
   *  local storage. Called when the user clicks "Upload" on the prompt. */
  async mergeAndClear(): Promise<void> {
    if (this._merging()) return;
    this._merging.set(true);

    try {
      const families = this.local.collection<ProductFamily>(Collections.catalogFamilies)();
      const variants = this.local.collection<ProductVariant>(Collections.catalogVariants)();
      const customers = this.local.collection<Customer>(Collections.customers)();
      const invoices = this.local.collection<Invoice>(Collections.invoiceSaved)();
      const favoritesDoc = this.local.doc<{ ids: string[] }>(Collections.favorites)();
      // Receipt layout: handle both legacy array shape and new { elements } shape.
      const receiptLayoutRaw = this.local.doc<unknown>(Collections.receiptLayout)();
      const receiptLayoutElements: unknown[] | null = Array.isArray(receiptLayoutRaw)
        ? receiptLayoutRaw
        : (receiptLayoutRaw as { elements?: unknown[] } | null)?.elements ?? null;
      const invoiceDefaults = this.local.doc<unknown>(Collections.invoiceDefaults)();
      const currencyDoc = this.local.doc<{ rates: Record<string, number>; base: string }>(Collections.currencyRates)();

      // Upload collections.
      if (families.length > 0) {
        await this.activeProvider.replaceCollection(Collections.catalogFamilies, families);
      }
      if (variants.length > 0) {
        await this.activeProvider.replaceCollection(Collections.catalogVariants, variants);
      }
      if (customers.length > 0) {
        await this.activeProvider.replaceCollection(Collections.customers, customers);
      }
      if (invoices.length > 0) {
        await this.activeProvider.replaceCollection(Collections.invoiceSaved, invoices);
      }

      // Upload single-doc values.
      if (favoritesDoc && favoritesDoc.ids.length > 0) {
        await this.activeProvider.setDoc(Collections.favorites, favoritesDoc);
      }
      // Always normalize receipt layout to the new { elements } shape on upload.
      if (receiptLayoutElements && receiptLayoutElements.length > 0) {
        await this.activeProvider.setDoc(Collections.receiptLayout, { elements: receiptLayoutElements });
      }
      if (invoiceDefaults) {
        await this.activeProvider.setDoc(Collections.invoiceDefaults, invoiceDefaults);
      }
      if (currencyDoc) {
        await this.activeProvider.setDoc(Collections.currencyRates, currencyDoc);
      }

      // Scan all merged data for `idb://` image refs and enqueue them
      // for cloud sync. The refs stay as `idb://local-id` in the
      // Firestore docs — the sync queue uploads the bytes and writes
      // a mapping so other devices can resolve them.
      await this.enqueueLocalImagesForSync(families, variants, invoices, receiptLayoutElements);

      // Clear local storage so the device starts fresh.
      await this.clearLocalData();

      this._dismissed.set(true);
    } catch (err) {
      console.error('[FirstLoginMerge] Merge failed:', err);
      throw err;
    } finally {
      this._merging.set(false);
    }
  }

  /** Dismiss the prompt without merging. Local data stays untouched. */
  dismiss(): void {
    this._dismissed.set(true);
  }

  /** Wipe all local-storage data under the pgpos: prefix. */
  private clearLocalData(): Promise<void> {
    if (typeof localStorage === 'undefined') return Promise.resolve();
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('pgpos:')) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    return Promise.resolve();
  }

  /**
   * Scan all merged data for `idb://` image refs and enqueue them for
   * cloud sync.
   *
   * When a user signs in with existing local data, the data (and its
   * `idb://` refs) is copied to Firestore. But the image bytes only
   * exist in local IDB — they were never uploaded because the user was
   * signed out. This method collects all `idb://` refs from the merged
   * data, reads their bytes from local IDB, and enqueues upload
   * operations in the sync queue. The sync queue flushes when online,
   * uploads to Storage, and writes a mapping doc so other devices can
   * resolve the same `idb://` ref.
   *
   * The refs in Firestore docs stay as `idb://local-id` — they don't
   * change. The mapping collection bridges local → cloud.
   *
   * Skips refs that already have a mapping (image already synced from
   * another device) — avoids redundant uploads + orphaned cloud images.
   */
  private async enqueueLocalImagesForSync(
    families: ProductFamily[],
    variants: ProductVariant[],
    invoices: Invoice[],
    receiptLayoutElements: unknown[] | null,
  ): Promise<void> {
    const refs = this.collectImageRefs(families, variants, invoices, receiptLayoutElements);
    if (refs.size === 0) return;

    // Read bytes + check mappings IN PARALLEL — much faster than
    // sequential for users with many images.
    const entries = await Promise.all(
      Array.from(refs).map(async (ref) => {
        const parsed = parseStoredFileRef(ref);
        if (!parsed) return null;
        const localId = parsed.id;

        // Skip if mapping already exists (image already synced from
        // another device — no point re-uploading).
        const existingCloudPath = this.mappings.getCloudPath(localId);
        if (existingCloudPath) return null;

        const bytes = await this.fileStorage.readBytes({ id: localId, name: '', mimeType: '', size: 0 });
        if (!bytes) {
          console.warn('[FirstLoginMerge] Image bytes not found in IDB for', ref);
          return null;
        }

        const mime = guessMimeType(ref);
        const filename = `${localId}.${mime.split('/')[1] ?? 'bin'}`;
        return { localId, bytes, filename, mime };
      }),
    );

    // Enqueue the valid entries.
    for (const entry of entries) {
      if (!entry) continue;
      await this.syncQueue.enqueueUpload(entry);
    }
  }

  /** Collect all `idb://` refs from merged data into a Set (deduped). */
  private collectImageRefs(
    families: ProductFamily[],
    variants: ProductVariant[],
    invoices: Invoice[],
    receiptLayoutElements: unknown[] | null,
  ): Set<string> {
    const refs = new Set<string>();

    for (const f of families) {
      for (const img of f.images ?? []) {
        if (parseStoredFileRef(img.url)) refs.add(img.url);
      }
    }

    for (const v of variants) {
      for (const ov of v.overrides ?? []) {
        if (ov.key === 'images' && Array.isArray(ov.value)) {
          for (const img of ov.value) {
            if (parseStoredFileRef(img.url)) refs.add(img.url);
          }
        }
      }
    }

    for (const inv of invoices) {
      for (const line of inv.lines ?? []) {
        if (line.imageUrl && parseStoredFileRef(line.imageUrl)) {
          refs.add(line.imageUrl);
        }
      }
    }

    if (receiptLayoutElements) {
      for (const el of receiptLayoutElements) {
        if (typeof el !== 'object' || el === null) continue;
        const content = (el as { content?: unknown }).content;
        if (typeof content !== 'string') continue;
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (parseStoredFileRef(trimmed)) refs.add(trimmed);
        }
      }
    }

    return refs;
  }
}
