import { Injectable, inject, signal, effect, WritableSignal, Signal } from '@angular/core';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  deleteDoc,
  Unsubscribe,
} from 'firebase/firestore';
import { FirebaseService } from './firebase.service';
import { AuthService } from './auth.service';

/**
 * Manages the `image-mappings` Firestore collection — the bridge
 * between local image IDs and cloud Storage paths.
 *
 * Local-first principle: documents always carry `idb://local-id` refs.
 * Cloud Storage paths are NEVER written to documents. Instead, this
 * mapping collection stores `localId → cloudPath` so the
 * `ImageResolverService` can fetch cloud images for refs that aren't
 * in the local IDB (e.g. images uploaded from another device).
 *
 * Collection path: `users/{uid}/image-mappings/{localId}`
 * Document shape: `{ cloudPath: string, uploadedAt: number }`
 *
 * Reactive model: a single `onSnapshot` listener on the whole
 * collection keeps an in-memory `Map<localId, cloudPath>` in sync.
 * `getCloudPath(localId)` reads from this map — O(1), synchronous.
 *
 * Lifecycle:
 *   - Listener attaches lazily on first access AND re-attaches on auth
 *     user change (same pattern as FirestoreDataProvider).
 *   - Listener detaches + in-memory map clears on logout.
 *
 * Write methods (`setMapping`, `removeMapping`) are called by
 * `ImageSyncQueueService` after cloud upload/delete succeeds. They go
 * directly to Firestore (offline writes queue locally via Firestore
 * persistence, sync when reconnected).
 */
@Injectable({ providedIn: 'root' })
export class ImageMappingsService {
  private readonly fb = inject(FirebaseService);
  private readonly auth = inject(AuthService);

  /** In-memory map: localId → cloudPath. Reactive via signal. */
  private readonly _mappings: WritableSignal<ReadonlyMap<string, string>> =
    signal<ReadonlyMap<string, string>>(new Map());
  readonly mappings: Signal<ReadonlyMap<string, string>> = this._mappings.asReadonly();

  /** Active onSnapshot unsubscribe. */
  private mappingUnsub: Unsubscribe | null = null;

  /** Current auth uid — tracked to re-attach on user change. */
  private currentUid: string | null = null;

  /** Tracks whether the listener has been requested so the auth-change
   *  effect knows to re-attach it. */
  private listenerRequested = false;

  /** Tracks whether the listener has been retried (once) after an error.
   *  Prevents infinite retry loops on persistent permission errors. */
  private listenerRetried = false;

  constructor() {
    // Attach/detach the mapping listener on auth user changes.
    effect(() => {
      const user = this.auth.user();
      const newUid = user?.uid ?? null;
      if (newUid === this.currentUid) return;
      this.currentUid = newUid;
      this.detachListener();
      this._mappings.set(new Map());
      if (newUid && this.listenerRequested) {
        this.attachListener();
      }
    });

    // Clear on logout.
    effect(() => {
      const epoch = this.auth.logoutEpoch();
      if (epoch === 0) return;
      this.detachListener();
      this._mappings.set(new Map());
    });
  }

  /** Ensure the mapping listener is attached. Idempotent. Called
   *  lazily by `ImageResolverService` when it first needs to look up
   *  a mapping. Resets the retry flag so a failed listener can be
   *  retried when explicitly requested again. */
  ensureListener(): void {
    this.listenerRequested = true;
    if (this.mappingUnsub) return;
    if (!this.currentUid) return;
    this.attachListener();
  }

  /** Synchronously look up the cloud path for a local id. Returns
   *  `undefined` if no mapping exists (image not yet uploaded, or
   *  mapping not yet synced to this device). */
  getCloudPath(localId: string): string | undefined {
    return this._mappings().get(localId);
  }

  /** Async lookup with Firestore fallback. Tries the in-memory map
   *  first (instant); if not found, reads the mapping doc directly
   *  from Firestore. Used by the sync queue at flush time when the
   *  in-memory map may not have loaded yet. */
  async getCloudPathAsync(localId: string): Promise<string | undefined> {
    const cached = this._mappings().get(localId);
    if (cached) return cached;

    const firestore = this.fb.firestore;
    const uid = this.auth.user()?.uid;
    if (!firestore || !uid) return undefined;

    try {
      const snap = await getDoc(doc(firestore, 'users', uid, 'image-mappings', localId));
      if (snap.exists()) {
        const data = snap.data() as { cloudPath?: string };
        return data.cloudPath;
      }
    } catch (err) {
      console.warn('[ImageMappings] getCloudPathAsync failed for', localId, err);
    }
    return undefined;
  }

  /** Write a mapping doc. Called by `ImageSyncQueueService` after a
   *  successful cloud upload. */
  async setMapping(localId: string, cloudPath: string): Promise<void> {
    const firestore = this.fb.firestore;
    const uid = this.auth.user()?.uid;
    if (!firestore || !uid) return;
    await setDoc(doc(firestore, 'users', uid, 'image-mappings', localId), {
      cloudPath,
      uploadedAt: Date.now(),
    });
  }

  /** Delete a mapping doc. Called by `ImageSyncQueueService` after a
   *  successful cloud delete. */
  async removeMapping(localId: string): Promise<void> {
    const firestore = this.fb.firestore;
    const uid = this.auth.user()?.uid;
    if (!firestore || !uid) return;
    await deleteDoc(doc(firestore, 'users', uid, 'image-mappings', localId));
  }

  private attachListener(): void {
    const firestore = this.fb.firestore;
    const uid = this.currentUid;
    if (!firestore || !uid) return;

    const colRef = collection(firestore, 'users', uid, 'image-mappings');
    this.mappingUnsub = onSnapshot(
      colRef,
      (snap) => {
        const map = new Map<string, string>();
        snap.forEach((d) => {
          const data = d.data() as { cloudPath?: string };
          if (data.cloudPath) {
            map.set(d.id, data.cloudPath);
          }
        });
        this._mappings.set(map);
        // Listener recovered — reset retry flag so future errors can
        // retry once again.
        this.listenerRetried = false;
      },
      (err) => {
        console.error('[ImageMappings] Listener error:', err);
        this.detachListener();
        // Retry once after a short delay — handles the timing race
        // where the auth token hasn't propagated to Firestore's
        // internal state when the listener first attaches. Same
        // pattern as FirestoreDataProvider.
        if (!this.listenerRetried) {
          this.listenerRetried = true;
          const schedule = typeof window !== 'undefined' ? window.setTimeout : setTimeout;
          schedule(() => {
            // Only retry if the listener is still expected (user
            // hasn't signed out in the meantime).
            if (this.currentUid && this.listenerRequested && !this.mappingUnsub) {
              this.attachListener();
            }
          }, 500);
        }
      },
    );
  }

  private detachListener(): void {
    if (this.mappingUnsub) {
      this.mappingUnsub();
      this.mappingUnsub = null;
    }
  }
}
