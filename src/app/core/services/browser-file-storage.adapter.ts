import { Injectable } from '@angular/core';
import { FileStorageAdapter, StoredFile } from './file-storage.adapter';

/**
 * Web-mode file storage backed by IndexedDB.
 *
 * Storage layout:
 *   - Database: `pgpos-files`
 *   - Object store: `files` (keyPath: `id`)
 *   - Value: `{ ...StoredFile, blob: Blob }`
 *
 * URL resolution: blobs are read from IndexedDB and wrapped in
 * `URL.createObjectURL`. The resulting `blob:` URLs are cached per-id for
 * the lifetime of the page so repeated `<img src>` lookups don't re-read
 * IndexedDB. The cache is cleared on `beforeunload` to revoke the URLs.
 *
 * Tauri migration path:
 *   When Tauri is set up, replace this provider with `TauriFileStorageAdapter`
 *   in `app.config.ts`. The `StoredFile` shape stays the same; only the URL
 *   format changes (from `blob:` to `asset://`).
 */
@Injectable({ providedIn: 'root' })
export class BrowserFileStorageAdapter extends FileStorageAdapter {
  private readonly dbName = 'pgpos-files';
  private readonly storeName = 'files';
  private readonly dbPromise: Promise<IDBDatabase>;
  /** id → blob URL cache (page-lifetime). */
  private readonly urlCache = new Map<string, string>();

  constructor() {
    super();
    this.dbPromise = this.openDb();
    // Revoke all cached blob URLs on page unload.
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        for (const url of this.urlCache.values()) {
          URL.revokeObjectURL(url);
        }
      });
    }
  }

  /** Open (or create) the IndexedDB database. */
  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available in this environment.'));
        return;
      }
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async save(file: File): Promise<StoredFile> {
    const id = `idb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stored: StoredFile = {
      id,
      name: file.name,
      mimeType: file.type,
      size: file.size,
    };
    // Store the file as raw bytes (ArrayBuffer) rather than as a Blob —
    // structured cloning of Blob across IndexedDB boundaries can lose the
    // Blob type in some environments (e.g. jsdom), and storing bytes is
    // also closer to how Tauri's `fs` plugin works.
    const bytes = await file.arrayBuffer();
    const db = await this.dbPromise;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).put({ ...stored, bytes });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return stored;
  }

  async resolveUrl(stored: StoredFile): Promise<string> {
    const cached = this.urlCache.get(stored.id);
    if (cached) return cached;

    const bytes = await this.readBytes(stored);
    if (!bytes) {
      throw new Error(`File not found in storage: ${stored.id}`);
    }
    const blob = new Blob([bytes], { type: stored.mimeType });
    const url = URL.createObjectURL(blob);
    this.urlCache.set(stored.id, url);
    return url;
  }

  async readBytes(stored: StoredFile): Promise<ArrayBuffer | null> {
    const bytes = await this.readRawBytes(stored.id);
    return bytes ?? null;
  }

  async delete(stored: StoredFile): Promise<void> {
    const db = await this.dbPromise;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).delete(stored.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const url = this.urlCache.get(stored.id);
    if (url) {
      URL.revokeObjectURL(url);
      this.urlCache.delete(stored.id);
    }
  }

  /** Read the raw ArrayBuffer from IndexedDB by id. */
  private async readRawBytes(id: string): Promise<ArrayBuffer | null> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).get(id);
      req.onsuccess = () => {
        const result = req.result as ({ bytes: ArrayBuffer } & StoredFile) | undefined;
        resolve(result?.bytes ?? null);
      };
      req.onerror = () => reject(req.error);
    });
  }
}
