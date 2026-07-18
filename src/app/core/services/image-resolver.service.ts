import { Injectable, inject } from '@angular/core';
import { FileStorageAdapter, StoredFile, parseStoredFileRef } from './file-storage.adapter';
import { FirebaseStorageService, parseFirebaseStorageRef } from './firebase-storage.service';

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
 * Resolution is async and cached per-reference for the page lifetime.
 * Firebase Storage download URLs contain a token that expires (~1 hour),
 * but the cache is best-effort — if a cached URL expires, the browser
 * shows a broken image and the next resolve call refreshes it.
 *
 * For PDF generation (where `fetch()` hits CORS on Firebase Storage
 * download URLs), use `resolveToDataUri()` instead — it downloads bytes
 * via the Firebase SDK for `fbstorage://` refs, bypassing CORS entirely.
 */
@Injectable({ providedIn: 'root' })
export class ImageResolverService {
  private readonly storage: FileStorageAdapter;
  private readonly fbStorage = inject(FirebaseStorageService);

  /** Allow explicit adapter injection (used by tests). */
  constructor(storage?: FileStorageAdapter) {
    this.storage = storage ?? inject(FileStorageAdapter);
  }

  /** ref → resolved URL (cached for page lifetime). */
  private readonly cache = new Map<string, string>();
  /** ref → in-flight promise (dedupes concurrent resolutions). */
  private readonly inflight = new Map<string, Promise<string>>();
  /** ref → data URI (cached for PDF generation). */
  private readonly dataUriCache = new Map<string, string>();

  /**
   * Resolve an image URL reference to a real, browser-usable URL.
   * Accepts `idb://`, `fbstorage://`, or standard URLs (returned as-is).
   */
  async resolve(url: string | undefined | null): Promise<string> {
    if (!url) return '';

    // Check if it's a Firebase Storage reference.
    const fbRef = parseFirebaseStorageRef(url);
    if (fbRef) {
      const cached = this.cache.get(url);
      if (cached) return cached;

      const existing = this.inflight.get(url);
      if (existing) return existing;

      const promise = (async () => {
        const resolved = await this.fbStorage.resolveUrl(url);
        this.cache.set(url, resolved);
        this.inflight.delete(url);
        return resolved;
      })();

      this.inflight.set(url, promise);
      return promise;
    }

    // Check if it's an IndexedDB reference.
    const idbRef = parseStoredFileRef(url);
    if (!idbRef) {
      // Not a stored reference — return as-is (http, https, data, blob, etc.)
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
      this.inflight.delete(url);
      return resolved;
    })();

    this.inflight.set(url, promise);
    return promise;
  }

  /**
   * Resolve an image reference to a data URI (base64-encoded).
   *
   * This is used by PdfService for inlining images into the PDF canvas.
   * For `fbstorage://` refs, it downloads bytes via the Firebase SDK
   * (`getBytes`) — this bypasses CORS entirely, unlike `fetch()` on the
   * download URL. For `idb://` refs, it reads bytes from IndexedDB.
   * For standard URLs, it falls back to `fetch()`.
   *
   * Results are cached per-ref for the page lifetime.
   */
  async resolveToDataUri(url: string | undefined | null): Promise<string> {
    if (!url) return '';

    // Check cache first.
    const cached = this.dataUriCache.get(url);
    if (cached) return cached;

    // If it's already a data URI, return as-is.
    if (url.startsWith('data:')) {
      this.dataUriCache.set(url, url);
      return url;
    }

    // Firebase Storage ref — download bytes via SDK (no CORS).
    const fbRef = parseFirebaseStorageRef(url);
    if (fbRef) {
      const bytes = await this.fbStorage.getBytes(url);
      if (bytes) {
        const dataUri = this.arrayBufferToDataUri(bytes, this.guessMimeType(url));
        this.dataUriCache.set(url, dataUri);
        return dataUri;
      }
      return '';
    }

    // IndexedDB ref — read bytes from IDB.
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

    // Standard URL — fall back to fetch(). This may hit CORS for
    // cross-origin images, but that's the best we can do without the
    // Firebase SDK. The caller should handle failures gracefully.
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

  /** Convert an ArrayBuffer to a base64 data URI. */
  private arrayBufferToDataUri(buffer: ArrayBuffer, mimeType: string): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    const base64 = btoa(binary);
    return `data:${mimeType};base64,${base64}`;
  }

  /** Guess MIME type from URL extension. */
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

  /** Convert a Blob to a data URI. */
  private blobToDataUri(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error instanceof Error ? reader.error : new Error(String(reader.error)));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Synchronously check whether a reference has already been resolved.
   * Returns the cached URL or empty string.
   */
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
}
