import { Injectable, inject } from '@angular/core';
import { FileStorageAdapter, StoredFile, parseStoredFileRef } from './file-storage.adapter';
import { FirebaseStorageService } from './firebase-storage.service';
import { ImageMappingsService } from './image-mappings.service';
import { ImageSyncQueueService } from './image-sync-queue.service';
import { AuthService } from './auth.service';

export interface UploadedFile {
  /**
   * Stable URL reference that survives page reloads. ALWAYS `idb://<id>`.
   *
   * Documents carry this ref. Cloud path is NEVER written to documents —
   * it lives only in the `image-mappings` Firestore collection. This is
   * the local-first principle: local IDB is the source of truth, cloud
   * is a mirror.
   */
  url: string;
  stored: StoredFile;
  filename: string;
  size: number;
  mimetype: string;
}

/**
 * Image upload service — local-first, auth-aware.
 *
 * Routing matrix:
 *
 *   │ signed-in? │ destination              │ ref returned │ cloud sync?
 *   ├────────────┼──────────────────────────┼──────────────┼──────────────
 *   │ yes        │ local IDB + sync queue   │ idb://       │ yes (outbox)
 *   │ no         │ local IDB only           │ idb://       │ no
 *
 * Always saves to local IDB first and returns an `idb://` ref
 * immediately. The caller writes this ref into Firestore documents
 * right away — no waiting for cloud upload. When signed-in, the bytes
 * are also enqueued in `ImageSyncQueueService` for background cloud
 * sync. Once the sync completes, an `image-mappings` doc is written so
 * other devices can resolve the same `idb://` ref.
 *
 * Delete: removes the local IDB image immediately. If a mapping exists
 * (image was previously synced to cloud), enqueues a cloud delete.
 * Offline deletes are fine — the cloud delete queues in the outbox and
 * flushes when reconnected.
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
  private readonly mappings = inject(ImageMappingsService);
  private readonly syncQueue = inject(ImageSyncQueueService);
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
   * Upload a single file. Always saves to local IDB and returns an
   * `idb://` ref. When signed-in, also enqueues the bytes in the sync
   * queue for background cloud upload.
   *
   * @throws Error with a user-friendly message if validation fails.
   */
  async upload(file: File): Promise<UploadedFile> {
    const validationError = this.validate(file);
    if (validationError) {
      throw new Error(validationError);
    }

    // Always save to local IDB first — this is the source of truth.
    const stored = await this.storage.save(file);
    const localRef = `idb://${stored.id}`;

    // When signed-in, enqueue for cloud sync. The sync queue flushes
    // when online; offline uploads just wait in the queue.
    if (this.auth.isAuthenticated()) {
      const bytes = await file.arrayBuffer();
      await this.syncQueue.enqueueUpload({
        localId: stored.id,
        bytes,
        filename: file.name,
        mime: file.type,
      });
    }
    // Signed-out: just local. The existing sign-in merge flow asks the
    // user about their local data; local images stay and the sync queue
    // picks them up if the user chooses to sync.

    return {
      url: localRef,
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
   *   - Always deletes from local IDB immediately.
   *   - Always enqueues a cloud delete. If the mapping is loaded, the
   *     cloudPath is passed; if not, the sync queue looks it up at flush
   *     time. If no mapping exists at flush time (image was never
   *     synced), the delete is silently dropped.
   *   - Cancels any pending upload for this local id (no point
   *     uploading something we're about to delete).
   */
  async delete(url: string): Promise<void> {
    if (!url) return;

    const idbRef = parseStoredFileRef(url);
    if (!idbRef) return;

    const localId = idbRef.id;

    // Try to get cloudPath from in-memory map. If not loaded, pass
    // undefined — the sync queue will look it up at flush time.
    const cloudPath = this.mappings.getCloudPath(localId);
    await this.syncQueue.enqueueDelete(localId, cloudPath);

    // Always delete from local IDB.
    try {
      await this.storage.delete({ id: localId, name: '', mimeType: '', size: 0 });
    } catch (err) {
      console.error('[UploadService] Failed to delete local image:', url, err);
    }
  }
}
