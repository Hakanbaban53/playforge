import { Injectable, inject, effect } from '@angular/core';
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  getBytes,
} from 'firebase/storage';
import { FirebaseService } from './firebase.service';
import { AuthService } from './auth.service';

/**
 * Firebase Storage image service.
 *
 * Uploads image blobs to Firebase Storage under `users/{uid}/images/{id}`
 * and returns stable references that survive page reloads and sync across
 * devices. Used by `UploadService` when the user is signed in.
 *
 * URL scheme: `fbstorage://{path}` — a pseudo-URL that the
 * `ImageResolverService` resolves to a real HTTPS download URL via
 * `getDownloadURL()`. The download URL is time-limited (Firebase tokens
 * expire after ~1 hour), so we cache it and refresh on demand.
 *
 * Cache invalidation: the in-memory `urlCache` is cleared on every
 * logout (driven by `AuthService.logoutEpoch`) so a stale URL from one
 * user's session is never reused after a different user logs in on the
 * same device.
 */

/** Prefix for Firebase Storage pseudo-URLs stored in catalog/invoice data. */
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

@Injectable({ providedIn: 'root' })
export class FirebaseStorageService {
  private readonly fb = inject(FirebaseService);
  private readonly auth = inject(AuthService);

  /** Download URL cache: Storage path → HTTPS URL. */
  private readonly urlCache = new Map<string, string>();

  constructor() {
    effect(() => {
      const epoch = this.auth.logoutEpoch();
      if (epoch === 0) return;
      this.urlCache.clear();
    });
  }

  /** Upload a file to Firebase Storage. Returns a stable `fbstorage://`
   *  reference that can be stored in Firestore documents.
   *  @throws Error if not signed in, Firebase unavailable, or upload fails. */
  async upload(file: File): Promise<{ ref: string; downloadUrl: string }> {
    const storage = this.fb.storage;
    const uid = this.auth.user()?.uid;
    if (!storage || !uid) {
      throw new Error('Not signed in — cannot upload to cloud storage.');
    }

    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
    const imageId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const path = `users/${uid}/images/${imageId}.${ext}`;
    const storageRef = ref(storage, path);

    await uploadBytes(storageRef, file, { contentType: file.type });

    const downloadUrl = await getDownloadURL(storageRef);
    const refStr = buildFirebaseStorageRef(path);
    this.urlCache.set(path, downloadUrl);

    return { ref: refStr, downloadUrl };
  }

  /** Resolve a `fbstorage://{path}` reference to a usable HTTPS URL.
   *  Caches the result and refreshes on error (token expiry). */
  async resolveUrl(refUrl: string): Promise<string> {
    const parsed = parseFirebaseStorageRef(refUrl);
    if (!parsed) return refUrl;

    const cached = this.urlCache.get(parsed.path);
    if (cached) return cached;

    const storage = this.fb.storage;
    if (!storage) return '';

    try {
      const downloadUrl = await getDownloadURL(ref(storage, parsed.path));
      this.urlCache.set(parsed.path, downloadUrl);
      return downloadUrl;
    } catch (err) {
      console.error('[FirebaseStorage] Failed to get download URL:', err);
      return '';
    }
  }

  /** Delete a file from Firebase Storage by its `fbstorage://` reference. */
  async delete(refUrl: string): Promise<void> {
    const parsed = parseFirebaseStorageRef(refUrl);
    if (!parsed) return;

    const storage = this.fb.storage;
    if (!storage) return;

    try {
      await deleteObject(ref(storage, parsed.path));
      this.urlCache.delete(parsed.path);
    } catch (err) {
      console.error('[FirebaseStorage] Delete failed:', err);
    }
  }

  /** Download the raw bytes of a Firebase Storage file via the SDK.
   *
   *  Uses XHR under the hood, which IS subject to CORS. The Firebase
   *  Storage bucket MUST have CORS configured for this to work from a
   *  browser. See `cors.json` in the project root and apply with:
   *
   *    gsutil cors set cors.json gs://YOUR_BUCKET.appspot.com
   *
   *  @param refUrl A `fbstorage://{path}` reference.
   *  @returns The file contents as an ArrayBuffer, or null on failure. */
  async getBytes(refUrl: string): Promise<ArrayBuffer | null> {
    const parsed = parseFirebaseStorageRef(refUrl);
    if (!parsed) return null;

    const storage = this.fb.storage;
    if (!storage) return null;

    try {
      return await getBytes(ref(storage, parsed.path), 10 * 1024 * 1024);
    } catch (err) {
      console.warn('[FirebaseStorage] getBytes failed (CORS?) for', refUrl, err);
      return null;
    }
  }

  /** True if Firebase Storage is available (user signed in + cloud enabled). */
  get available(): boolean {
    return this.fb.enabled && this.auth.isAuthenticated() && !!this.fb.storage;
  }
}
