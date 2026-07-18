import { Injectable, inject } from '@angular/core';
import { FileStorageAdapter, StoredFile, parseStoredFileRef } from './file-storage.adapter';
import { FirebaseStorageService, parseFirebaseStorageRef } from './firebase-storage.service';
import { AuthService } from './auth.service';

export interface UploadedFile {
  /**
   * Stable URL reference that survives page reloads. Format:
   *   - Logged out: `idb://<id>` — resolved to a `blob:` URL on demand.
   *   - Logged in: `fbstorage://<path>` — resolved to a Firebase download URL.
   */
  url: string;
  stored: StoredFile;
  filename: string;
  size: number;
  mimetype: string;
}

/**
 * Image upload service — auth-aware.
 *
 * When the user is NOT signed in: images go to IndexedDB via
 * `BrowserFileStorageAdapter` and return `idb://` references. Fully
 * local, no cloud.
 *
 * When the user IS signed in: images go to Firebase Storage under
 * `users/{uid}/images/{id}` and return `fbstorage://` references. The
 * upload must succeed BEFORE the reference is returned — callers never
 * get a URL that doesn't point to a real uploaded file. This is the
 * "upload-then-link" pattern: the Firestore document that references
 * the image is only written after the upload completes.
 *
 * If the upload fails (offline, network error, quota exceeded, etc.),
 * `upload()` throws an Error with a user-friendly message. The caller
 * is responsible for surfacing it — we do NOT silently fail.
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
  private readonly fbStorage = inject(FirebaseStorageService);
  private readonly auth = inject(AuthService);

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
   * Upload a single file. When signed in, goes to Firebase Storage;
   * when signed out, goes to IndexedDB.
   *
   * @throws Error with a user-friendly message if validation or upload fails.
   *   The error is surfaced to the user — we do NOT silently fail.
   */
  async upload(file: File): Promise<UploadedFile> {
    const validationError = this.validate(file);
    if (validationError) {
      throw new Error(validationError);
    }

    // Auth-aware routing: Firebase Storage when logged in, IDB when not.
    if (this.fbStorage.available) {
      try {
        const result = await this.fbStorage.upload(file);
        return {
          url: result.ref,
          stored: {
            id: result.ref,
            name: file.name,
            mimeType: file.type,
            size: file.size,
          },
          filename: file.name,
          size: file.size,
          mimetype: file.type,
        };
      } catch (err) {
        // Surface the error — don't silently fall back to IDB. The
        // user needs to know the cloud upload failed so they can retry
        // or check their connection.
        const msg = err instanceof Error ? err.message : 'Cloud upload failed.';
        throw new Error(`Image upload failed: ${msg}`, { cause: err });
      }
    }

    // Logged out (or Firebase unavailable) — use local IndexedDB.
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

  /**
   * Delete an uploaded image.
   * If the URL is a Firebase Storage ref (`fbstorage://`), deletes it from Firebase.
   * If the URL is an IndexedDB ref (`idb://`), deletes it from IndexedDB.
   */
  async delete(url: string): Promise<void> {
    if (!url) return;

    // Check if it is a Firebase Storage ref
    const fbRef = parseFirebaseStorageRef(url);
    if (fbRef && this.fbStorage.available) {
      try {
        await this.fbStorage.delete(url);
      } catch (err) {
        console.error('[UploadService] Failed to delete Firebase image:', url, err);
      }
      return;
    }

    // Check if it is an IndexedDB ref
    const idbRef = parseStoredFileRef(url);
    if (idbRef) {
      try {
        await this.storage.delete({ id: idbRef.id, name: '', mimeType: '', size: 0 });
      } catch (err) {
        console.error('[UploadService] Failed to delete IndexedDB image:', url, err);
      }
      return;
    }
  }
}

