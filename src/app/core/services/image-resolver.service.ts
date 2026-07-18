import { Injectable, inject, effect } from '@angular/core';
import { FileStorageAdapter, StoredFile, parseStoredFileRef } from './file-storage.adapter';
import { FirebaseStorageService, parseFirebaseStorageRef } from './firebase-storage.service';
import { AuthService } from './auth.service';

/**
 * Resolves image URL references to real, browser-usable URLs.
 *
 * Supported reference schemes:
 *   - `idb://<id>`           → IndexedDB (logged out mode)
 *   - `fbstorage://<path>`   → Firebase Storage (logged in mode)
 *   - `http://`/`https://`   → returned as-is
 *   - `data:`/`blob:`        → returned as-is
 *   - `asset://`             → returned as-is (Tauri mode)
 *
 * Cache invalidation:
 *   - The in-memory URL cache is cleared on every logout (driven by
 *     `AuthService.logoutEpoch`). This prevents a stale cached URL
 *     from one user's session from being reused after a different user
 *     logs in on the same device.
 *   - Firebase Storage download URLs contain a token that expires
 *     (~1 hour). If a cached URL expires, the browser shows a broken
 *     image and the next resolve call refreshes it.
 *
 * Auth gating:
 *   - `fbstorage://` refs are only resolved when the user is
 *     authenticated. If auth state is already "logged out" when
 *     `resolve()` is called, we return '' instead of attempting a
 *     doomed request that would 403.
 *
 * For PDF generation, use `resolveToDataUri()` — it downloads bytes
 * via the Firebase SDK for `fbstorage://` refs, bypassing CORS.
 */
@Injectable({ providedIn: 'root' })
export class ImageResolverService {
  private readonly storage: FileStorageAdapter;
  private readonly fbStorage = inject(FirebaseStorageService);
  private readonly auth = inject(AuthService);

  constructor(storage?: FileStorageAdapter) {
    this.storage = storage ?? inject(FileStorageAdapter);

    effect(() => {
      const epoch = this.auth.logoutEpoch();
      if (epoch === 0) return;
      this.clearCache();
    });
  }

  /** ref → resolved URL. */
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

    const fbRef = parseFirebaseStorageRef(url);
    if (fbRef) {
      if (!this.auth.isAuthenticated()) return '';

      const cached = this.cache.get(url);
      if (cached) return cached;

      const existing = this.inflight.get(url);
      if (existing) return existing;

      const promise = (async () => {
        try {
          const resolved = await this.fbStorage.resolveUrl(url);
          this.cache.set(url, resolved);
          return resolved;
        } catch (err) {
          const code = (err as { code?: string }).code ?? '';
          if (code !== 'storage/unauthorized' && code !== 'storage/object-not-found') {
            console.warn('[ImageResolver] fbstorage resolve failed for', url, err);
          }
          return '';
        } finally {
          this.inflight.delete(url);
        }
      })();

      this.inflight.set(url, promise);
      return promise;
    }

    const idbRef = parseStoredFileRef(url);
    if (!idbRef) {
      return url;
    }

    const cached = this.cache.get(url);
    if (cached) return cached;

    const existing = this.inflight.get(url);
    if (existing) return existing;

    const promise = (async () => {
      const stored: StoredFile = {
        id: idbRef.id,
        name: '',
        mimeType: '',
        size: 0,
      };
      const resolved = await this.storage.resolveUrl(stored);
      this.cache.set(url, resolved);
      return resolved;
    })();

    this.inflight.set(url, promise);
    return promise;
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

    const fbRef = parseFirebaseStorageRef(url);
    if (fbRef) {
      if (!this.auth.isAuthenticated()) return '';
      const bytes = await this.fbStorage.getBytes(url);
      if (bytes) {
        const dataUri = this.arrayBufferToDataUri(bytes, this.guessMimeType(url));
        this.dataUriCache.set(url, dataUri);
        return dataUri;
      }
      return '';
    }

    const idbRef = parseStoredFileRef(url);
    if (idbRef) {
      const stored: StoredFile = { id: idbRef.id, name: '', mimeType: '', size: 0 };
      const bytes = await this.storage.readBytes(stored);
      if (bytes) {
        const dataUri = this.arrayBufferToDataUri(bytes, this.guessMimeType(url));
        this.dataUriCache.set(url, dataUri);
        return dataUri;
      }
      return '';
    }

    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) return '';
      const blob = await res.blob();
      const dataUri = await this.blobToDataUri(blob);
      this.dataUriCache.set(url, dataUri);
      return dataUri;
    } catch {
      return '';
    }
  }

  private arrayBufferToDataUri(buffer: ArrayBuffer, mimeType: string): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    const base64 = btoa(binary);
    return `data:${mimeType};base64,${base64}`;
  }

  private guessMimeType(url: string): string {
    const ext = url.split('.').pop()?.toLowerCase().split('?')[0] ?? '';
    switch (ext) {
      case 'png': return 'image/png';
      case 'jpg':
      case 'jpeg': return 'image/jpeg';
      case 'webp': return 'image/webp';
      case 'gif': return 'image/gif';
      case 'svg': return 'image/svg+xml';
      default: return 'image/png';
    }
  }

  private blobToDataUri(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error instanceof Error ? reader.error : new Error(String(reader.error)));
      reader.readAsDataURL(blob);
    });
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
    this.cache.clear();
    this.dataUriCache.clear();
    this.inflight.clear();
  }
}
