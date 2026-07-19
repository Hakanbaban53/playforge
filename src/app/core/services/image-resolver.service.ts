import { Injectable, inject, effect, DestroyRef } from '@angular/core';
import { FileStorageAdapter, StoredFile, parseStoredFileRef } from './file-storage.adapter';
import { FirebaseStorageService, parseFirebaseStorageRef } from './firebase-storage.service';
import { ImageMappingsService } from './image-mappings.service';
import { AuthService } from './auth.service';
import { guessMimeType, arrayBufferToDataUri } from '../utils/mime';

/**
 * Resolves image URL references to real, browser-usable URLs.
 *
 * Local-first resolution flow for `idb://<local-id>`:
 *
 *   1. In-memory blob URL cache → return cached `blob:` URL (instant).
 *
 *   2. Local IDB blob → create `blob:` URL, cache it, return (offline-
 *      capable, no network). This is the happy path for images uploaded
 *      on THIS device.
 *
 *   3. If not in local IDB: check `ImageMappingsService` for a cloud
 *      path. If found, fetch bytes from Firebase Storage → SAVE to
 *      local IDB under the original localId (so future resolves hit
 *      the IDB cache instead of re-fetching from cloud every page
 *      load) → create `blob:` URL, cache it, return. This is the
 *      cross-device path.
 *
 *   4. If no mapping (image not yet synced, or mapping not loaded):
 *      return '' (broken image placeholder). No network spam.
 *
 * Blob URL lifecycle:
 *   - Each resolved ref gets a `blob:` URL via `URL.createObjectURL`.
 *   - URLs are cached in-memory per ref for the page lifetime.
 *   - On `clearCache()` (logout) and on component destroy, all cached
 *     URLs are revoked via `URL.revokeObjectURL` to prevent memory
 *     leaks. The `beforeunload` listener also revokes on page unload.
 *
 * Other ref schemes (backward compat + external):
 *   - `fbstorage://<path>` → cloud fetch via SDK (old data, kept for compat)
 *   - `http://`/`https://` → returned as-is
 *   - `data:`/`blob:` → returned as-is
 *   - `asset://` → returned as-is (Tauri mode)
 *
 * Auth gating:
 *   - Cloud fetches (mapping → cloud, or `fbstorage://` direct) only
 *     happen when authenticated. Unauthenticated → return ''.
 */
@Injectable({ providedIn: 'root' })
export class ImageResolverService {
  private readonly storage: FileStorageAdapter;
  private readonly fbStorage = inject(FirebaseStorageService);
  private readonly mappings = inject(ImageMappingsService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  constructor(storage?: FileStorageAdapter) {
    this.storage = storage ?? inject(FileStorageAdapter);

    effect(() => {
      const epoch = this.auth.logoutEpoch();
      if (epoch === 0) return;
      this.clearCache();
    });

    // Revoke all blob URLs on page unload to prevent leaks.
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.revokeAllUrlsBound);
      this.destroyRef.onDestroy(() => {
        window.removeEventListener('beforeunload', this.revokeAllUrlsBound);
        this.revokeAllUrls();
      });
    }
  }

  /** ref → resolved blob: URL. */
  private cache = new Map<string, string>();
  /** ref → in-flight promise (dedupes concurrent resolutions). */
  private inflight = new Map<string, Promise<string>>();
  /** ref → data URI (cached for PDF generation). */
  private dataUriCache = new Map<string, string>();

  /**
   * Resolve an image URL reference to a real, browser-usable URL.
   */
  async resolve(url: string | undefined | null): Promise<string> {
    if (!url) return '';

    // Local-first: idb:// refs are the primary ref type.
    const idbRef = parseStoredFileRef(url);
    if (idbRef) {
      return this.resolveLocalRef(url, idbRef.id);
    }

    // Backward compat: fbstorage:// refs (old data).
    const fbRef = parseFirebaseStorageRef(url);
    if (fbRef) {
      return this.resolveCloudRef(url, fbRef.path);
    }

    // Passthrough: http(s), data:, blob:, asset://
    return url;
  }

  /** Resolve an `idb://<local-id>` ref. */
  private async resolveLocalRef(refUrl: string, localId: string): Promise<string> {
    const cached = this.cache.get(refUrl);
    if (cached) return cached;

    const existing = this.inflight.get(refUrl);
    if (existing) return existing;

    const promise = (async () => {
      try {
        // Step 1: try local IDB.
        const stored: StoredFile = { id: localId, name: '', mimeType: '', size: 0 };
        const localBytes = await this.storage.readBytes(stored);
        if (localBytes) {
          return this.cacheBlobUrl(refUrl, localBytes);
        }

        // Step 2: not in local IDB — check mapping for a cloud path.
        // Only attempt cloud fetch when authenticated.
        if (!this.auth.isAuthenticated()) {
          return '';
        }

        // Ensure the mapping listener is attached (lazy).
        this.mappings.ensureListener();
        const cloudPath = this.mappings.getCloudPath(localId);
        if (!cloudPath) {
          // No mapping — image not yet synced, or mapping not loaded.
          return '';
        }

        // Step 3: fetch from cloud.
        const cloudBytes = await this.fbStorage.getBytes(cloudPath);
        if (!cloudBytes) {
          return '';
        }

        // Step 4: cache in local IDB under the ORIGINAL localId so
        // future resolves (and other components on the same page)
        // hit the IDB cache instead of re-fetching from cloud.
        const mime = guessMimeType(cloudPath);
        try {
          await this.storage.saveWithId(localId, cloudBytes, mime, localId);
        } catch (err) {
          // IDB save failure is non-fatal — the blob URL still works
          // for this session, just won't survive a page reload.
          console.warn('[ImageResolver] Failed to cache cloud image in IDB:', err);
        }

        return this.cacheBlobUrl(refUrl, cloudBytes);
      } catch (err) {
        console.warn('[ImageResolver] resolve failed for', refUrl, err);
        return '';
      } finally {
        this.inflight.delete(refUrl);
      }
    })();

    this.inflight.set(refUrl, promise);
    return promise;
  }

  /** Resolve a `fbstorage://<path>` ref (backward compat). */
  private async resolveCloudRef(refUrl: string, cloudPath: string): Promise<string> {
    if (!this.auth.isAuthenticated()) return '';

    const cached = this.cache.get(refUrl);
    if (cached) return cached;

    const existing = this.inflight.get(refUrl);
    if (existing) return existing;

    const promise = (async () => {
      try {
        const bytes = await this.fbStorage.getBytes(cloudPath);
        if (!bytes) return '';
        return this.cacheBlobUrl(refUrl, bytes);
      } catch (err) {
        const code = (err as { code?: string }).code ?? '';
        if (code !== 'storage/unauthorized' && code !== 'storage/object-not-found') {
          console.warn('[ImageResolver] fbstorage resolve failed for', refUrl, err);
        }
        return '';
      } finally {
        this.inflight.delete(refUrl);
      }
    })();

    this.inflight.set(refUrl, promise);
    return promise;
  }

  /** Create a blob: URL from bytes, cache it, and return it. */
  private cacheBlobUrl(refUrl: string, bytes: ArrayBuffer): string {
    const blob = new Blob([bytes]);
    const blobUrl = URL.createObjectURL(blob);
    this.cache.set(refUrl, blobUrl);
    return blobUrl;
  }

  /**
   * Resolve an image reference to a data URI (base64-encoded).
   * Used by PdfService for inlining images into the PDF canvas.
   */
  async resolveToDataUri(url: string | undefined | null): Promise<string> {
    if (!url) return '';

    const cached = this.dataUriCache.get(url);
    if (cached) return cached;

    if (url.startsWith('data:')) {
      this.dataUriCache.set(url, url);
      return url;
    }

    const idbRef = parseStoredFileRef(url);
    if (idbRef) {
      // Try local IDB first.
      const stored: StoredFile = { id: idbRef.id, name: '', mimeType: '', size: 0 };
      let bytes = await this.storage.readBytes(stored);

      // Not in local IDB — try mapping → cloud.
      if (!bytes && this.auth.isAuthenticated()) {
        this.mappings.ensureListener();
        const cloudPath = this.mappings.getCloudPath(idbRef.id);
        if (cloudPath) {
          bytes = await this.fbStorage.getBytes(cloudPath);
        }
      }

      if (bytes) {
        const dataUri = await arrayBufferToDataUri(bytes, guessMimeType(url));
        this.dataUriCache.set(url, dataUri);
        return dataUri;
      }
      return '';
    }

    const fbRef = parseFirebaseStorageRef(url);
    if (fbRef) {
      if (!this.auth.isAuthenticated()) return '';
      const bytes = await this.fbStorage.getBytes(fbRef.path);
      if (bytes) {
        const dataUri = await arrayBufferToDataUri(bytes, guessMimeType(url));
        this.dataUriCache.set(url, dataUri);
        return dataUri;
      }
      return '';
    }

    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) return '';
      const blob = await res.blob();
      const { blobToDataUri } = await import('../utils/mime');
      const dataUri = await blobToDataUri(blob);
      this.dataUriCache.set(url, dataUri);
      return dataUri;
    } catch {
      return '';
    }
  }

  /** Synchronously check whether a reference has already been resolved. */
  getCached(url: string | undefined | null): string {
    if (!url) return '';
    return this.cache.get(url) ?? '';
  }

  /** Pre-resolve a batch of URLs (used before PDF generation). */
  async preload(urls: (string | undefined | null)[]): Promise<void> {
    await Promise.all(urls.map((u) => this.resolve(u)));
  }

  /** True if the URL is a stored reference (idb:// or fbstorage://). */
  isStoredRef(url: string | undefined | null): boolean {
    if (!url) return false;
    return parseStoredFileRef(url) !== null || parseFirebaseStorageRef(url) !== null;
  }

  clearCache(): void {
    this.revokeAllUrls();
    this.dataUriCache.clear();
    this.inflight.clear();
  }

  /** Revoke all cached blob: URLs to free memory. Called on logout,
   *  page unload, and component destroy. */
  private revokeAllUrls(): void {
    for (const url of this.cache.values()) {
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    }
    this.cache.clear();
  }

  private readonly revokeAllUrlsBound = (): void => this.revokeAllUrls();
}
