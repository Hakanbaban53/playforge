import { Injectable, inject } from '@angular/core';
import {
  ref,
  uploadBytes,
  deleteObject,
  getBytes,
} from 'firebase/storage';
import { FirebaseService } from './firebase.service';
import { AuthService } from './auth.service';

/**
 * Firebase Storage image service — cloud-only operations.
 *
 * Local-first principle: this service is ONLY called by
 * `ImageSyncQueueService` (the outbox). It performs raw cloud
 * operations (upload, delete, fetch bytes). It does NOT resolve refs
 * for the UI — that's `ImageResolverService`'s job, which goes through
 * local IDB first, then mapping, then cloud.
 *
 * Upload returns a `cloudPath` (the Storage path), NOT a `fbstorage://`
 * ref. The caller (`ImageSyncQueueService`) writes this path to the
 * `image-mappings` collection. Documents never see cloud paths.
 *
 * Offline fast-fail: `upload()` throws `'offline'` immediately when
 * `navigator.onLine` is false. Storage has no offline queue — calling
 * `uploadBytes()` offline makes the SDK retry the POST with exponential
 * backoff, flooding the console with `ERR_INTERNET_DISCONNECTED` errors.
 * The sync queue only flushes when online, so this is a defensive guard.
 */

/** Prefix for Firebase Storage pseudo-URLs (kept for backward compat
 *  with any old `fbstorage://` refs in existing data). */
export const FB_STORAGE_PREFIX = 'fbstorage://';

/** Parse a `fbstorage://{path}` URL into its Storage path. */
export function parseFirebaseStorageRef(url: string): { path: string } | null {
  if (!url.startsWith(FB_STORAGE_PREFIX)) return null;
  return { path: url.slice(FB_STORAGE_PREFIX.length) };
}

/** Build a `fbstorage://{path}` URL from a Storage path. */
export function buildFirebaseStorageRef(path: string): string {
  return `${FB_STORAGE_PREFIX}${path}`;
}

export interface CloudUploadResult {
  /** The Storage path, e.g. `users/{uid}/images/img-123.jpeg`. */
  cloudPath: string;
}

@Injectable({ providedIn: 'root' })
export class FirebaseStorageService {
  private readonly fb = inject(FirebaseService);
  private readonly auth = inject(AuthService);

  /** Upload a file to Firebase Storage. Returns the cloud path.
   *
   *  INVARIANT: each `upload()` call generates a unique storage path
   *  (via `Date.now()` + `Math.random()`). This is what makes
   *  path-only mapping safe — no two uploads ever collide.
   *
   *  @throws Error if not signed in, Firebase unavailable, offline,
   *  or upload fails. */
  async upload(file: File): Promise<CloudUploadResult> {
    const storage = this.fb.storage;
    const uid = this.auth.user()?.uid;
    if (!storage || !uid) {
      throw new Error('Not signed in — cannot upload to cloud storage.');
    }

    // Defensive fast-fail when offline. The sync queue should only
    // flush when online, but this catches direct callers.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('offline');
    }

    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
    const imageId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cloudPath = `users/${uid}/images/${imageId}.${ext}`;
    const storageRef = ref(storage, cloudPath);

    await uploadBytes(storageRef, file, { contentType: file.type });

    return { cloudPath };
  }

  /** Delete a file from Firebase Storage by its cloud path. */
  async deleteByPath(cloudPath: string): Promise<void> {
    const storage = this.fb.storage;
    if (!storage) return;

    // Defensive fast-fail when offline. The sync queue should only
    // flush when online, but this catches direct callers.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('offline');
    }

    try {
      await deleteObject(ref(storage, cloudPath));
    } catch (err) {
      // `object-not-found` is fine — the image was already deleted
      // (e.g. user deleted from another device). Don't surface as error.
      const code = (err as { code?: string }).code ?? '';
      if (code !== 'storage/object-not-found') {
        throw err;
      }
    }
  }

  /** Download the raw bytes of a Storage file by its cloud path.
   *  Used by `ImageResolverService` to fetch cloud images for local
   *  refs that aren't in the IDB cache (cross-device scenario).
   *
   *  Uses XHR under the hood, which IS subject to CORS. The Firebase
   *  Storage bucket MUST have CORS configured. See `cors.json`.
   *
   *  @returns The file contents as an ArrayBuffer, or null on failure. */
  async getBytes(cloudPath: string): Promise<ArrayBuffer | null> {
    const storage = this.fb.storage;
    if (!storage) return null;

    try {
      return await getBytes(ref(storage, cloudPath), 10 * 1024 * 1024);
    } catch (err) {
      console.warn('[FirebaseStorage] getBytes failed for', cloudPath, err);
      return null;
    }
  }

  /** True if Firebase Storage is available (user signed in + cloud enabled). */
  get available(): boolean {
    return this.fb.enabled && this.auth.isAuthenticated() && !!this.fb.storage;
  }
}
