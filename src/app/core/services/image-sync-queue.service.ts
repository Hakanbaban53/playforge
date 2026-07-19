import { Injectable, inject, signal, effect, WritableSignal, Signal } from '@angular/core';
import { FirebaseStorageService } from './firebase-storage.service';
import { ImageMappingsService } from './image-mappings.service';
import { FileStorageAdapter } from './file-storage.adapter';
import { AuthService } from './auth.service';

/**
 * Outbox-style sync queue for local-first image operations.
 *
 * Local-first principle: every image operation (upload, delete) is
 * committed to the local IDB FIRST, then enqueued here for cloud sync.
 * Documents never wait for cloud confirmation — they carry `idb://`
 * refs immediately, and the cloud mirror catches up in the background.
 *
 * Two operation kinds:
 *
 *   - `upload`: local IDB has the bytes, cloud doesn't. Flush uploads
 *     to Firebase Storage, writes a mapping doc
 *     (`image-mappings/{localId}`), and removes the queue item.
 *
 *   - `delete`: local IDB image already deleted, cloud image needs
 *     removal. Flush deletes from Firebase Storage, removes the
 *     mapping doc, and removes the queue item.
 *
 * Flush triggers:
 *   - Constructor effect: when `auth.isAuthenticated()` + `navigator.onLine`.
 *   - Window `online` event.
 *   - After every `enqueue*()` call (immediate attempt if online).
 *
 * Retry: retryable errors (network, quota) retry with exponential
 * backoff (1s → 30s cap). After MAX_RETRIES the item moves to `failed`
 * and stays in the queue for manual inspection (no auto-cleanup).
 *
 * Race condition handling: `processItem` re-reads the item from IDB
 * before each write to detect concurrent deletion (e.g. user deletes
 * an image while its upload is mid-flight). If the item is gone, the
 * operation aborts silently — no zombie items.
 *
 * Logout: `clear()` wipes the entire queue. Pending operations for the
 * previous user are discarded.
 *
 * IDB schema: database `pgpos-image-sync`, store `items` (keyPath: `id`),
 * indexes `by_localId` and `by_status`.
 */

export type SyncItemKind = 'upload' | 'delete';
export type SyncItemStatus = 'pending' | 'syncing' | 'failed';

export interface SyncItem {
  id: string;
  kind: SyncItemKind;
  /** The local ID (`idb://` ref's id). Used to find the item by local ref. */
  localId: string;
  /** For `upload`: the image bytes. Undefined for `delete`. */
  bytes?: ArrayBuffer;
  /** For `upload`: original filename + mime (for cloud path generation). */
  filename?: string;
  mime?: string;
  /** For `delete`: the cloud path to delete. Looked up from mapping at
   *  enqueue time (so we don't depend on the mapping still existing at
   *  flush time). */
  cloudPath?: string;
  status: SyncItemStatus;
  retryCount: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
/** Total bytes cap for the sync queue IDB store. When exceeded, new
 *  `enqueueUpload` calls log a warning and refuse to enqueue — prevents
 *  unbounded IDB growth from many large offline uploads. The user can
 *  free space by going online (items flush + delete) or by dismissing
 *  failed items. 200 MB is generous: ~20 images at 10 MB each. */
const MAX_QUEUE_BYTES = 200 * 1024 * 1024;

@Injectable({ providedIn: 'root' })
export class ImageSyncQueueService {
  private readonly fbStorage = inject(FirebaseStorageService);
  private readonly mappings = inject(ImageMappingsService);
  private readonly fileStorage = inject(FileStorageAdapter);
  private readonly auth = inject(AuthService);

  private readonly dbName = 'pgpos-image-sync';
  private readonly storeName = 'items';
  private readonly dbPromise: Promise<IDBDatabase> | null =
    typeof indexedDB === 'undefined' ? null : this.openDb();

  private readonly _items: WritableSignal<SyncItem[]> = signal<SyncItem[]>([]);
  readonly items: Signal<readonly SyncItem[]> = this._items.asReadonly();

  /** Count of pending + syncing items. Renamed from `pendingCount` —
   *  the old name was misleading because it included syncing items. */
  private readonly _activeCount: WritableSignal<number> = signal(0);
  readonly activeCount: Signal<number> = this._activeCount.asReadonly();

  private readonly _failedCount: WritableSignal<number> = signal(0);
  readonly failedCount: Signal<number> = this._failedCount.asReadonly();

  private readonly _isSyncing: WritableSignal<boolean> = signal(false);
  readonly isSyncing: Signal<boolean> = this._isSyncing.asReadonly();

  /** Prevents concurrent flushes. */
  private flushing: Promise<void> | null = null;

  constructor() {
    void this.refreshFromDb();

    effect(() => {
      const authed = this.auth.isAuthenticated();
      const online = typeof navigator === 'undefined' || navigator.onLine;
      if (authed && online) {
        void this.flush();
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => void this.flush());
    }

    effect(() => {
      const epoch = this.auth.logoutEpoch();
      if (epoch === 0) return;
      void this.clear();
    });
  }

  /** Enqueue an upload operation. Called by `UploadService` after
   *  saving the image to local IDB.
   *
   *  Refuses to enqueue if the total queue size would exceed
   *  `MAX_QUEUE_BYTES` — prevents unbounded IDB growth from many large
   *  offline uploads. The image is already saved in local IDB (source
   *  of truth), so refusing here only means it won't cloud-sync until
   *  the user frees space (goes online, dismisses failed items). */
  async enqueueUpload(payload: {
    localId: string;
    bytes: ArrayBuffer;
    filename: string;
    mime: string;
  }): Promise<void> {
    // Size cap check — refuse if adding this item would exceed the limit.
    const currentSize = await this.getQueueSizeBytes();
    if (currentSize + payload.bytes.byteLength > MAX_QUEUE_BYTES) {
      console.warn(
        '[ImageSyncQueue] Refusing to enqueue upload — queue size cap exceeded ' +
        `(${currentSize + payload.bytes.byteLength} > ${MAX_QUEUE_BYTES} bytes). ` +
        'Image stays in local IDB but will not cloud-sync until space is freed.',
      );
      return;
    }

    const now = Date.now();
    const item: SyncItem = {
      id: crypto.randomUUID(),
      kind: 'upload',
      localId: payload.localId,
      bytes: payload.bytes,
      filename: payload.filename,
      mime: payload.mime,
      status: 'pending',
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.putItem(item);
    await this.refreshFromDb();
    void this.flush();
  }

  /** Enqueue a delete operation. Called by `UploadService.delete()`.
   *
   *  `cloudPath` is optional — if not provided (mapping not loaded yet),
   *  the sync queue looks it up at flush time (in-memory map → Firestore
   *  fallback). If no mapping is found at flush time, the item is
   *  silently dropped (image was never synced to cloud). */
  async enqueueDelete(localId: string, cloudPath?: string): Promise<void> {
    // Remove any pending upload for this localId first — no point
    // uploading something we're about to delete.
    await this.removeByLocalId(localId);

    const now = Date.now();
    const item: SyncItem = {
      id: crypto.randomUUID(),
      kind: 'delete',
      localId,
      cloudPath,
      status: 'pending',
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.putItem(item);
    await this.refreshFromDb();
    void this.flush();
  }

  /** Cancel any pending operations for a local id. Called by
   *  `UploadService.delete()` when the image was never synced to cloud
   *  (no mapping) — just remove the local IDB image and any pending
   *  upload. */
  async removeByLocalId(localId: string): Promise<void> {
    const items = await this.getAllItems();
    for (const item of items) {
      if (item.localId === localId) {
        await this.deleteItem(item.id);
      }
    }
    await this.refreshFromDb();
  }

  /** Manual retry for failed items. */
  async retryFailed(): Promise<void> {
    const items = await this.getAllItems();
    for (const item of items) {
      if (item.status === 'failed') {
        item.status = 'pending';
        item.retryCount = 0;
        item.lastError = undefined;
        item.updatedAt = Date.now();
        await this.putItem(item);
      }
    }
    await this.refreshFromDb();
    void this.flush();
  }

  /** Remove a failed item without retrying. */
  async dismiss(itemId: string): Promise<void> {
    await this.deleteItem(itemId);
    await this.refreshFromDb();
  }

  /** Wipe the entire queue. Called on logout. */
  async clear(): Promise<void> {
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error(String(tx.error)));
    });
    await this.refreshFromDb();
  }

  // ---- Flush logic ----

  private async flush(): Promise<void> {
    if (this.flushing) return this.flushing;

    // Don't flush when offline or unauthenticated — items stay pending.
    const authed = this.auth.isAuthenticated();
    const online = typeof navigator === 'undefined' || navigator.onLine;
    if (!authed || !online) return;

    this.flushing = (async () => {
      this._isSyncing.set(true);
      try {
        const items = await this.getAllItems();
        const pending = items.filter((i) => i.status === 'pending' || i.status === 'syncing');
        for (const item of pending) {
          await this.processItem(item);
        }
      } finally {
        this._isSyncing.set(false);
        this.flushing = null;
        // Single refresh at the end — avoids N redundant IDB reads
        // during a batch (old code refreshed 3x per item).
        await this.refreshFromDb();
      }
    })();

    return this.flushing;
  }

  private async processItem(item: SyncItem): Promise<void> {
    // Re-read from IDB to detect concurrent deletion. If the user
    // deleted the image (and `removeByLocalId` cleared the queue item)
    // while this flush was starting, the item is gone — abort silently.
    const current = await this.getItem(item.id);
    if (!current) return;

    // Mark as syncing.
    current.status = 'syncing';
    current.updatedAt = Date.now();
    await this.putItem(current);

    try {
      if (current.kind === 'upload') {
        await this.processUpload(current);
      } else {
        await this.processDelete(current);
      }
      // Success — remove from queue. Re-check existence first (the
      // item may have been removed by a concurrent `removeByLocalId`).
      await this.deleteItem(current.id);
    } catch (err) {
      // Re-read to check if the item still exists — a concurrent
      // `removeByLocalId` may have deleted it while we were processing.
      const stillExists = await this.getItem(current.id);
      if (!stillExists) return;

      const isRetryable = this.isRetryableError(err);
      stillExists.retryCount += 1;
      stillExists.lastError = err instanceof Error ? err.message : String(err);
      stillExists.updatedAt = Date.now();

      if (isRetryable && stillExists.retryCount < MAX_RETRIES) {
        stillExists.status = 'pending';
        const delay = this.getBackoffDelay(stillExists.retryCount);
        const schedule = typeof window !== 'undefined' ? window.setTimeout : setTimeout;
        schedule(() => void this.flush(), delay);
      } else {
        stillExists.status = 'failed';
      }
      await this.putItem(stillExists);
    }
  }

  private async processUpload(item: SyncItem): Promise<void> {
    if (!item.bytes || !item.filename || !item.mime) {
      throw new Error('Upload item missing bytes/filename/mime');
    }
    // Upload to Firebase Storage.
    const file = new File([item.bytes], item.filename, { type: item.mime });
    const result = await this.fbStorage.upload(file);
    // Write mapping doc so other devices can find this cloud image.
    await this.mappings.setMapping(item.localId, result.cloudPath);
  }

  private async processDelete(item: SyncItem): Promise<void> {
    // cloudPath may be missing if the mapping wasn't loaded at enqueue
    // time. Look it up now (in-memory map → Firestore fallback).
    const cloudPath = item.cloudPath ?? (await this.mappings.getCloudPathAsync(item.localId));
    if (!cloudPath) {
      // No mapping found — image was never synced to cloud. Nothing to
      // delete. Drop the item silently.
      return;
    }
    // Delete from Firebase Storage.
    await this.fbStorage.deleteByPath(cloudPath);
    // Remove mapping doc.
    await this.mappings.removeMapping(item.localId);
  }

  // ---- Error classification + backoff ----

  /**
   * Classify an error as retryable or permanent.
   *
   * Default: NOT retryable. Only known transient errors (network,
   * quota, offline) are retried. Permanent errors (403, 404, invalid
   * credential) fail immediately to avoid wasting retries on errors
   * that will never succeed.
   */
  private isRetryableError(err: unknown): boolean {
    const code = (err as { code?: string }).code ?? '';
    const message = err instanceof Error ? err.message : '';

    // Permanent errors — never retry.
    if (code === 'storage/unauthorized') return false;
    if (code === 'storage/object-not-found') return false;
    if (code === 'auth/invalid-credential') return false;

    // Known transient errors — retry.
    if (code === 'storage/quota-exceeded') return true;
    if (code === 'storage/retry-limit-exceeded') return true;
    if (code === 'auth/network-request-failed') return true;
    if (message === 'offline') return true;
    if (/network|timeout|temporarily|fetch/i.test(message)) return true;

    // Unknown errors — don't retry by default. Logging surfaces them
    // for investigation without spamming retries.
    return false;
  }

  private getBackoffDelay(retryCount: number): number {
    return Math.min(BACKOFF_BASE_MS * 2 ** retryCount, BACKOFF_MAX_MS);
  }

  // ---- IDB operations ----

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('by_localId', 'localId', { unique: false });
          store.createIndex('by_status', 'status', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error(String(req.error)));
    });
  }

  private async putItem(item: SyncItem): Promise<void> {
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error(String(tx.error)));
    });
  }

  private async deleteItem(id: string): Promise<void> {
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error(String(tx.error)));
    });
  }

  private async getItem(id: string): Promise<SyncItem | null> {
    if (!this.dbPromise) return null;
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).get(id);
      req.onsuccess = () => resolve((req.result as SyncItem | undefined) ?? null);
      req.onerror = () => reject(new Error(String(req.error)));
    });
  }

  private async getAllItems(): Promise<SyncItem[]> {
    if (!this.dbPromise) return [];
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).getAll();
      req.onsuccess = () => resolve((req.result as SyncItem[]) ?? []);
      req.onerror = () => reject(new Error(String(req.error)));
    });
  }

  private async refreshFromDb(): Promise<void> {
    const items = await this.getAllItems();
    this._items.set(items);
    this._activeCount.set(
      items.filter((i) => i.status === 'pending' || i.status === 'syncing').length,
    );
    this._failedCount.set(items.filter((i) => i.status === 'failed').length);
  }

  /** Sum of all upload items' byte sizes. Used by `enqueueUpload` to
   *  enforce the `MAX_QUEUE_BYTES` cap. */
  private async getQueueSizeBytes(): Promise<number> {
    const items = await this.getAllItems();
    return items.reduce((sum, item) => sum + (item.bytes?.byteLength ?? 0), 0);
  }
}
