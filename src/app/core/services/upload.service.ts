import { Injectable, inject } from '@angular/core';
import { FileStorageAdapter, StoredFile } from './file-storage.adapter';

export interface UploadedFile {
  /**
   * Stable URL reference that survives page reloads. Format:
   *   - Web: `idb://<id>` — resolved to a `blob:` URL on demand by the
   *     renderer (image-resolver.service.ts).
   *   - Tauri (future): `asset://localhost/<id>` — directly usable.
   *
   * The reference is stored in catalog/invoice data; the renderer resolves
   * it to a real URL just before display or PDF generation.
   */
  url: string;
  /** StoredFile metadata (id, name, mimeType, size). */
  stored: StoredFile;
  /** Convenience: original filename. */
  filename: string;
  /** Convenience: file size in bytes. */
  size: number;
  /** Convenience: MIME type. */
  mimetype: string;
}

/**
 * Image upload service — fully client-side. No HTTP, no server.
 *
 * Flow:
 *   1. Validate the file (type + size) client-side.
 *   2. Hand the file to the `FileStorageAdapter`, which persists it (IndexedDB
 *      in web mode, Tauri `fs` in future Tauri mode).
 *   3. Return an `UploadedFile` with a stable `idb://` reference.
 *
 * The `idb://` URL is stored in catalog/invoice data and survives reloads.
 * When the renderer needs a real URL (for `<img src>` or canvas drawing),
 * it calls `ImageResolverService.resolve(url)` to get a `blob:` URL.
 */
@Injectable({ providedIn: 'root' })
export class UploadService {
  private static readonly ALLOWED_MIME = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
    'image/svg+xml',
  ]);
  private static readonly MAX_BYTES = 10 * 1024 * 1024; // 10 MB

  private readonly storage = inject(FileStorageAdapter);

  /** Validate a file before upload. Returns `null` if valid, or an error message. */
  validate(file: File): string | null {
    if (!UploadService.ALLOWED_MIME.has(file.type)) {
      return `Unsupported file type: ${file.type}. Allowed: PNG, JPEG, WebP, GIF, SVG.`;
    }
    if (file.size > UploadService.MAX_BYTES) {
      return `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${UploadService.MAX_BYTES / 1024 / 1024} MB.`;
    }
    return null;
  }

  /**
   * Persist a single file via the storage adapter. Returns an `UploadedFile`
   * whose `url` is a stable `idb://` reference.
   *
   * @throws Error with a user-friendly message if validation fails.
   */
  async upload(file: File): Promise<UploadedFile> {
    const validationError = this.validate(file);
    if (validationError) {
      throw new Error(validationError);
    }
    const stored = await this.storage.save(file);
    return {
      url: `idb://${stored.id}`,
      stored,
      filename: stored.name,
      size: stored.size,
      mimetype: stored.mimeType,
    };
  }

  /** Upload multiple files in parallel. */
  async uploadMany(files: File[]): Promise<UploadedFile[]> {
    return Promise.all(files.map((f) => this.upload(f)));
  }
}
