import { Injectable, inject } from '@angular/core';
import { FileStorageAdapter, StoredFile, parseStoredFileRef } from './file-storage.adapter';

/**
 * Resolves `idb://<id>` image references to real, browser-usable URLs.
 *
 * Why this exists:
 *   - `UploadService` returns `idb://<id>` references that survive page
 *     reloads (they're just strings stored in catalog/invoice data).
 *   - But `<img src="idb://...">` doesn't work — the browser doesn't know
 *     the `idb:` scheme. We need to resolve the reference to a real `blob:`
 *     URL (web) or `asset://` URL (Tauri) before the browser can use it.
 *   - The PDF service also needs this: html2canvas can capture `blob:` URLs
 *     but not `idb:` pseudo-URLs.
 *
 * Resolution is async (IndexedDB read in web mode) and cached per-id for
 * the page lifetime. Templates that need a sync URL should use the
 * `| resolveImage` pipe (which renders a placeholder until resolved) or
 * pre-resolve via the `useImage()` helper.
 */
@Injectable({ providedIn: 'root' })
export class ImageResolverService {
  private readonly storage: FileStorageAdapter;

  /** Allow explicit adapter injection (used by tests). */
  constructor(storage?: FileStorageAdapter) {
    // Allow explicit adapter injection (used by tests).
    this.storage = storage ?? inject(FileStorageAdapter);
  }

  /** id → resolved URL (cached for page lifetime). */
  private readonly cache = new Map<string, string>();
  /** id → in-flight promise (dedupes concurrent resolutions). */
  private readonly inflight = new Map<string, Promise<string>>();

  /**
   * Resolve an image URL reference to a real, browser-usable URL.
   *
   * Accepted inputs:
   *   - `idb://<id>`        → resolved via FileStorageAdapter
   *   - `http://...`        → returned as-is
   *   - `https://...`       → returned as-is
   *   - `data:...`          → returned as-is
   *   - `blob:...`          → returned as-is
   *   - `asset://...`       → returned as-is (Tauri mode)
   *   - empty / undefined   → returns empty string
   *
   * The returned promise resolves once the underlying storage read completes.
   * Subsequent calls with the same `idb://` id return the cached URL.
   */
  async resolve(url: string | undefined | null): Promise<string> {
    if (!url) return '';

    const ref = parseStoredFileRef(url);
    if (!ref) {
      // Not an idb:// reference — return as-is.
      return url;
    }

    const cached = this.cache.get(ref.id);
    if (cached) return cached;

    const existing = this.inflight.get(ref.id);
    if (existing) return existing;

    const promise = (async () => {
      const stored: StoredFile = {
        id: ref.id,
        name: '', // not needed for URL resolution
        mimeType: '',
        size: 0,
      };
      const resolved = await this.storage.resolveUrl(stored);
      this.cache.set(ref.id, resolved);
      this.inflight.delete(ref.id);
      return resolved;
    })();

    this.inflight.set(ref.id, promise);
    return promise;
  }

  /**
   * Synchronously check whether an `idb://` reference has already been
   * resolved in this page session. Returns the cached URL or empty string.
   *
   * Useful for templates that want to render immediately if the image is
   * already loaded, and trigger async resolution otherwise.
   */
  getCached(url: string | undefined | null): string {
    if (!url) return '';
    const ref = parseStoredFileRef(url);
    if (!ref) return url;
    return this.cache.get(ref.id) ?? '';
  }

  /**
   * Pre-resolve a batch of URLs. Useful before PDF generation — call this
   * with every image URL in the receipt so html2canvas sees real blob:
   * URLs when it runs.
   */
  async preload(urls: (string | undefined | null)[]): Promise<void> {
    await Promise.all(urls.map((u) => this.resolve(u)));
  }

  /** True if the URL is an `idb://` reference (vs. an external/data/blob URL). */
  isStoredRef(url: string | undefined | null): boolean {
    return !!url && parseStoredFileRef(url) !== null;
  }
}
