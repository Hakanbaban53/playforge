import { Injectable, Signal, signal, inject, DestroyRef, WritableSignal, effect } from '@angular/core';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  query,
  onSnapshot,
  Unsubscribe,
  writeBatch,
  getDocs,
  DocumentSnapshot,
  QuerySnapshot,
} from 'firebase/firestore';
import { FirebaseService } from './firebase.service';
import { AuthService } from './auth.service';
import { DataProvider, SyncState } from './data-provider';

/**
 * Firestore-backed data provider — used when the user is signed in.
 *
 * Data layout:
 *
 *   users/{uid}/{collectionName}/{docId}
 *
 * Each collection lives under the user's UID namespace. Firestore
 * security rules enforce that users can only read/write their own
 * subtree, so no userId filter is needed in queries — the rules block
 * cross-user access at the database level.
 *
 * Reactive model:
 *   - `collection<T>()` opens an `onSnapshot` listener on the
 *     collection and feeds every emitted snapshot into a signal.
 *   - The signal is the source of truth for the UI; consumers don't
 *     care whether the snapshot came from the local cache or the
 *     server.
 *   - Writes (`setRecord`, `removeRecord`) go directly to Firestore;
 *     the onSnapshot listener picks up the change and updates the
 *     signal. This round-trip is intentional — it ensures the signal
 *     always reflects the authoritative server state, not a local
 *     optimistic update that might be rejected by rules.
 *
 * Auth-state reattachment:
 *   - Listeners are attached lazily when a collection/doc signal is
 *     first accessed, AND re-attached whenever the auth user changes.
 *   - This handles the timing race where the DataProviderService swaps
 *     to Firestore before the Firestore SDK's internal auth token has
 *     fully propagated. By re-attaching on auth user change, we
 *     guarantee the listener always runs with a valid auth context.
 *   - If a listener gets `permission-denied`, we retry once after a
 *     short delay — this handles the edge case where the token is still
 *     propagating on first sign-in.
 *
 * Sync state:
 *   - Each snapshot carries `metadata.fromCache` and
 *     `metadata.hasPendingWrites`. We aggregate these across all open
 *     collections to produce a single `syncState` signal:
 *       - hasPendingWrites anywhere → 'syncing'
 *       - all fromCache and no pending writes → 'offline'
 *       - otherwise → 'synced'
 *
 * Offline persistence:
 *   - Configured in `FirebaseService` via `persistentLocalCache`.
 *   - When offline, Firestore serves reads from cache and queues
 *     writes. When the connection restores, queued writes flush and
 *     listeners re-emit with server data.
 */
@Injectable({ providedIn: 'root' })
export class FirestoreDataProvider extends DataProvider {
  private readonly fb = inject(FirebaseService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  /** Collection name → signal of records. */
  private readonly collectionSignals = new Map<string, WritableSignal<unknown[]>>();
  /** Collection name → unsubscribe function for the onSnapshot listener. */
  private readonly collectionUnsubs = new Map<string, Unsubscribe>();
  /** Doc name → signal of (T | null). */
  private readonly docSignals = new Map<string, WritableSignal<unknown>>();
  /** Doc name → unsubscribe function. */
  private readonly docUnsubs = new Map<string, Unsubscribe>();
  /** Track which collections/docs have been requested so we can
   *  re-attach their listeners on auth user changes. */
  private readonly requestedCollections = new Set<string>();
  private readonly requestedDocs = new Set<string>();
  /** Track retries so we don't loop forever on permission-denied. */
  private readonly retriedCollections = new Set<string>();
  private readonly retriedDocs = new Set<string>();

  /** Per-collection sync metadata — aggregated into `syncState`. */
  private readonly collectionMeta = new Map<string, { hasPending: boolean }>();

  private readonly _syncState = signal<SyncState>('synced');
  private readonly _lastSyncedAt = signal<number | null>(null);

  readonly syncState: Signal<SyncState> = this._syncState.asReadonly();
  readonly lastSyncedAt: Signal<number | null> = this._lastSyncedAt.asReadonly();

  /** Current auth uid — tracked via effect so we can re-attach
   *  listeners when it changes. */
  private currentUid: string | null = null;

  /** Bound online/offline event handlers. Delegate to `FirebaseService`
   *  which is the single source of truth for network state. */
  private readonly onOnlineBound = (): void => {
    void this.fb.setNetworkEnabled(true);
    this.recomputeSyncState();
  };
  private readonly onOfflineBound = (): void => {
    void this.fb.setNetworkEnabled(false);
    this.recomputeSyncState();
  };

  constructor() {
    super();
    this.destroyRef.onDestroy(() => {
      void this.dispose();
    });

    // Listen to browser online/offline events. When offline, call
    // `disableNetwork()` so the Firestore SDK stops retrying the write
    // stream (which spams "transport errored" warnings and makes
    // `setDoc()` promises hang). With network disabled, writes commit
    // to the local IndexedDB cache immediately and the promise resolves.
    //
    // Initial offline state is handled by `FirebaseService` (which calls
    // `disableNetwork()` immediately after Firestore init, before any
    // onSnapshot listener can attach). `FirebaseService` is the single
    // source of truth for the `networkDisabled` flag.
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnlineBound);
      window.addEventListener('offline', this.onOfflineBound);
    }

    // Re-attach all listeners whenever the auth user changes. This
    // handles the timing race where the provider swaps to Firestore
    // before the Firestore SDK's internal auth token has propagated.
    // By re-attaching on uid change, we guarantee the listener always
    // has a valid auth context.
    effect(() => {
      const user = this.auth.user();
      const newUid = user?.uid ?? null;
      if (newUid === this.currentUid) return;
      this.currentUid = newUid;
      if (newUid) {
        // Auth just became available (or changed user). Re-attach
        // all previously-requested listeners with the new auth context.
        this.reattachAllListeners();
      }
    });
  }

  collection<T>(name: string): Signal<T[]> {
    return this.getOrCreateCollectionSignal<T>(name).asReadonly();
  }

  doc<T>(name: string): Signal<T | null> {
    return this.getOrCreateDocSignal<T>(name).asReadonly();
  }

  async setRecord<T extends { id: string }>(name: string, value: T): Promise<void> {
    const firestore = this.fb.firestore;
    const uid = this.auth.user()?.uid;
    if (!firestore || !uid) {
      console.warn('[FirestoreDataProvider] Not signed in — write ignored.');
      return;
    }
    this.getOrCreateCollectionSignal<T>(name);
    // Firestore rejects `undefined` field values (unlike localStorage,
    // which silently drops them via JSON.stringify). Sanitize before write.
    const sanitized = sanitizeForFirestore(value);
    await setDoc(doc(firestore, 'users', uid, name, value.id), sanitized as Record<string, unknown>);
  }

  async removeRecord(name: string, id: string): Promise<void> {
    const firestore = this.fb.firestore;
    const uid = this.auth.user()?.uid;
    if (!firestore || !uid) return;
    this.getOrCreateCollectionSignal<{ id: string }>(name);
    await deleteDoc(doc(firestore, 'users', uid, name, id));
  }

  async replaceCollection<T extends { id: string }>(name: string, values: T[]): Promise<void> {
    const firestore = this.fb.firestore;
    const uid = this.auth.user()?.uid;
    if (!firestore || !uid) return;
    this.getOrCreateCollectionSignal<T>(name);

    const colRef = collection(firestore, 'users', uid, name);
    const existing = await getDocs(colRef);
    const keepIds = new Set(values.map((v) => v.id));

    const batch = writeBatch(firestore);
    for (const d of existing.docs) {
      if (!keepIds.has(d.id)) {
        batch.delete(d.ref);
      }
    }
    for (const v of values) {
      batch.set(doc(firestore, 'users', uid, name, v.id), sanitizeForFirestore(v) as Record<string, unknown>);
    }
    await batch.commit();
  }

  async setDoc<T>(name: string, value: T): Promise<void> {
    const firestore = this.fb.firestore;
    const uid = this.auth.user()?.uid;
    if (!firestore || !uid) return;
    this.getOrCreateDocSignal<T>(name);
    await setDoc(doc(firestore, 'users', uid, name, 'value'), sanitizeForFirestore(value) as Record<string, unknown>);
  }

  async removeDoc(name: string): Promise<void> {
    const firestore = this.fb.firestore;
    const uid = this.auth.user()?.uid;
    if (!firestore || !uid) return;
    await deleteDoc(doc(firestore, 'users', uid, name, 'value'));
  }

  dispose(): Promise<void> {
    for (const unsub of this.collectionUnsubs.values()) unsub();
    for (const unsub of this.docUnsubs.values()) unsub();
    this.collectionUnsubs.clear();
    this.docUnsubs.clear();
    this.collectionSignals.clear();
    this.docSignals.clear();
    this.collectionMeta.clear();
    this.retriedCollections.clear();
    this.retriedDocs.clear();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnlineBound);
      window.removeEventListener('offline', this.onOfflineBound);
    }
    // Re-enable the network so the next user starts with a clean state.
    void this.fb.setNetworkEnabled(true);
    this._syncState.set('synced');
    return Promise.resolve();
  }
  private getOrCreateCollectionSignal<T>(name: string): WritableSignal<T[]> {
    let sig = this.collectionSignals.get(name) as WritableSignal<T[]> | undefined;
    if (!sig) {
      sig = signal<T[]>([]);
      this.collectionSignals.set(name, sig);
    }
    // Track that this collection has been requested so the auth-change
    // effect knows to re-attach it.
    this.requestedCollections.add(name);
    // Try to attach the listener immediately (no-op if already attached
    // or if uid isn't available yet — the auth effect will retry).
    this.attachCollectionListener<T>(name, sig);
    return sig;
  }

  private getOrCreateDocSignal<T>(name: string): WritableSignal<T | null> {
    let sig = this.docSignals.get(name) as WritableSignal<T | null> | undefined;
    if (!sig) {
      sig = signal<T | null>(null);
      this.docSignals.set(name, sig);
    }
    this.requestedDocs.add(name);
    this.attachDocListener<T>(name, sig);
    return sig;
  }

  /** Attach an onSnapshot listener for a collection. No-op if already
   *  attached or if auth isn't ready. */
  private attachCollectionListener<T>(name: string, sig: WritableSignal<T[]>): void {
    // Already attached? Skip.
    if (this.collectionUnsubs.has(name)) return;

    const firestore = this.fb.firestore;
    const uid = this.currentUid;
    if (!firestore || !uid) return;

    const colRef = collection(firestore, 'users', uid, name);
    const q = query(colRef);

    // includeMetadataChanges: true ensures the listener fires when
    // snapshot.metadata changes (e.g. hasPendingWrites transitions from
    // true to false when the server acks a local write). Without this,
    // the sync indicator would get stuck on "syncing" because the
    // metadata-only update never reaches the listener.
    const unsub = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap: QuerySnapshot) => {
        const docs: T[] = [];
        snap.forEach((d) => {
          docs.push({ id: d.id, ...(d.data() as object) } as T);
        });
        sig.set(docs);
        this.collectionMeta.set(name, {
          hasPending: snap.metadata.hasPendingWrites,
        });
        this.recomputeSyncState();
      },
      (err) => {
        console.error(`[FirestoreDataProvider] Listener error on ${name}:`, err);
        // Retry once after a short delay — handles the timing race where
        // the auth token hasn't propagated to Firestore's internal state
        // when the listener first attaches.
        if (!this.retriedCollections.has(name)) {
          this.retriedCollections.add(name);
          const existing = this.collectionUnsubs.get(name);
          if (existing) {
            existing();
            this.collectionUnsubs.delete(name);
          }
          window.setTimeout(() => {
            this.attachCollectionListener<T>(name, sig);
          }, 500);
        }
      },
    );

    this.collectionUnsubs.set(name, unsub);
  }

  /** Attach an onSnapshot listener for a doc. No-op if already attached
   *  or if auth isn't ready. */
  private attachDocListener<T>(name: string, sig: WritableSignal<T | null>): void {
    if (this.docUnsubs.has(name)) return;

    const firestore = this.fb.firestore;
    const uid = this.currentUid;
    if (!firestore || !uid) return;

    const docRef = doc(firestore, 'users', uid, name, 'value');
    const unsub = onSnapshot(
      docRef,
      { includeMetadataChanges: true },
      (snap: DocumentSnapshot) => {
        sig.set(snap.exists() ? (snap.data() as T) : null);
      },
      (err) => {
        console.error(`[FirestoreDataProvider] Doc listener error on ${name}:`, err);
        if (!this.retriedDocs.has(name)) {
          this.retriedDocs.add(name);
          const existing = this.docUnsubs.get(name);
          if (existing) {
            existing();
            this.docUnsubs.delete(name);
          }
          window.setTimeout(() => {
            this.attachDocListener<T>(name, sig);
          }, 500);
        }
      },
    );

    this.docUnsubs.set(name, unsub);
  }

  /** Re-attach all previously-requested listeners. Called when the auth
   *  uid changes — handles the timing race where listeners were
   *  requested before auth was ready. */
  private reattachAllListeners(): void {
    // Detach existing listeners first (they may be attached to the
    // wrong uid or not at all).
    for (const unsub of this.collectionUnsubs.values()) unsub();
    for (const unsub of this.docUnsubs.values()) unsub();
    this.collectionUnsubs.clear();
    this.docUnsubs.clear();
    this.retriedCollections.clear();
    this.retriedDocs.clear();

    // Re-attach all requested collections.
    for (const name of this.requestedCollections) {
      const sig = this.collectionSignals.get(name);
      if (sig) this.attachCollectionListener(name, sig);
    }
    // Re-attach all requested docs.
    for (const name of this.requestedDocs) {
      const sig = this.docSignals.get(name);
      if (sig) this.attachDocListener(name, sig);
    }
  }

  private recomputeSyncState(): void {
    // Check if any collection has pending writes (local writes not yet
    // acknowledged by the server).
    let anyPending = false;
    for (const meta of this.collectionMeta.values()) {
      if (meta.hasPending) {
        anyPending = true;
        break;
      }
    }

    // Use navigator.onLine for the online/offline signal. This is far
    // more reliable than Firestore's `fromCache` flag, which is true
    // for the initial snapshot before the server responds (even on a
    // healthy connection) and stays true for empty collections that
    // never trigger a server round-trip.
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

    if (!isOnline) {
      // Offline — writes are queued locally and will sync when reconnected.
      // If there are pending writes, show 'syncing' (they're waiting to
      // upload); otherwise just 'offline' (idle, waiting for connection).
      this._syncState.set(anyPending ? 'syncing' : 'offline');
    } else if (anyPending) {
      // Online with pending writes — actively syncing.
      this._syncState.set('syncing');
    } else {
      // Online, no pending writes — all caught up.
      this._syncState.set('synced');
      this._lastSyncedAt.set(Date.now());
    }
  }
}

/**
 * Recursively strip `undefined` values from an object before writing to
 * Firestore. Firestore rejects `undefined` field values with
 * `Unsupported field value: undefined`, unlike localStorage which
 * silently drops them via `JSON.stringify()`.
 *
 * This is a deep clone — the original object is not mutated. Returns
 * the same shape but with all `undefined` fields removed (and any
 * nested objects/arrays sanitized too).
 *
 * Behavior:
 *   - Plain objects: recursively sanitize each field; omit fields
 *     whose sanitized value is `undefined`.
 *   - Arrays: recursively sanitize each element; keep `undefined`
 *     slots as `null` (Firestore arrays can contain null but not
 *     undefined).
 *   - Primitives (string/number/boolean/null): returned as-is.
 *   - `undefined`: returns `undefined` (caller decides to omit).
 *   - Dates, Blob, etc.: returned as-is (Firestore supports them).
 */
function sanitizeForFirestore<T>(value: T): T {
  return sanitizeValue(value) as T;
}

function sanitizeValue(value: unknown): unknown {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value !== 'object') return value;

  // Date — Firestore supports Date objects natively.
  if (value instanceof Date) return value;

  // Array — sanitize each element, convert undefined slots to null.
  if (Array.isArray(value)) {
    return value.map((v) => {
      const sanitized = sanitizeValue(v);
      return sanitized === undefined ? null : sanitized;
    });
  }

  // Plain object — sanitize each field, omit fields whose value is
  // undefined after sanitization.
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const sanitized = sanitizeValue(val);
    if (sanitized !== undefined) {
      out[key] = sanitized;
    }
  }
  return out;
}
