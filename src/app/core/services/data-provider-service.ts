import { Injectable, inject, computed, Signal, signal, effect } from '@angular/core';
import { DataProvider, SyncState } from './data-provider';
import { LocalDataProvider } from './local-data-provider';
import { FirestoreDataProvider } from './firestore-data-provider';
import { AuthService } from './auth.service';

/**
 * Data provider switcher.
 *
 * The app's data layer has two backends:
 *   - `LocalDataProvider`  — localStorage, no cloud. Used when logged out.
 *   - `FirestoreDataProvider` — Firestore + offline persistence. Used when logged in.
 *
 * Feature services inject `DataProvider` (the abstract class) and get
 * whichever backend is currently active. This service is responsible
 * for swapping them when the auth state changes.
 *
 * How the swap works:
 *   - Angular DI can't swap a provider instance at runtime, so we use
 *     a proxy pattern: this service implements `DataProvider` and
 *     delegates every call to whichever concrete provider is active.
 *   - On sign-in: dispose the local provider's signals (data stays in
 *     localStorage for safety), activate the Firestore provider.
 *   - On sign-out: dispose the Firestore provider (clears its cache),
 *     activate the local provider.
 *
 * The proxy approach means feature services don't need to re-inject
 * anything on auth change — they keep calling the same `DataProvider`
 * reference, and the underlying delegation target swaps transparently.
 *
 * IMPORTANT: feature services must re-read signals on auth change
 * because the underlying data changes (local → cloud or vice versa).
 * The `authChanged` signal fires on every auth transition; services
 * can `effect()` on it to re-subscribe.
 */
@Injectable({ providedIn: 'root' })
export class DataProviderService extends DataProvider {
  private readonly local = inject(LocalDataProvider);
  private readonly firestore = inject(FirestoreDataProvider);
  private readonly auth = inject(AuthService);

  /** Increments every time the active provider changes. Services can
   *  `effect()` on this to detect swaps and re-read their signals. */
  private readonly _providerVersion = signal(0);
  readonly providerVersion = this._providerVersion.asReadonly();

  /** Active backend name — used by the sync indicator. */
  private readonly _activeBackend = signal<'local' | 'firestore'>(
    this.auth.isAuthenticated() ? 'firestore' : 'local',
  );
  readonly activeBackend = this._activeBackend.asReadonly();

  constructor() {
    super();

    // React to auth changes — swap providers on sign-in / sign-out.
    effect(() => {
      const isAuth = this.auth.isAuthenticated();
      const target = isAuth ? 'firestore' : 'local';
      if (target === this._activeBackend()) return;

      // Tear down the old provider before activating the new one.
      // For local→firestore: this just clears in-memory signals; data
      //   stays in localStorage so the merge flow can read it.
      // For firestore→local: this calls clearPersistence() via the
      //   Firestore provider's dispose(), wiping the cloud cache so
      //   the next user on a shared device starts fresh.
      const old = this._activeBackend();
      this._activeBackend.set(target);

      // Dispose asynchronously — don't block the effect.
      const oldProvider = old === 'firestore' ? this.firestore : this.local;
      void oldProvider.dispose().then(() => {
        this._providerVersion.update((v) => v + 1);
      });
    });
  }

  private get active(): DataProvider {
    return this._activeBackend() === 'firestore' ? this.firestore : this.local;
  }

  get syncState(): Signal<SyncState> {
    // We can't return a different signal per call cleanly, so we expose
    // a computed that reads from whichever provider is active. The
    // computed re-evaluates when providerVersion changes.
    return computed(() => {
      this._providerVersion(); // track swaps
      return this.active.syncState();
    });
  }

  get lastSyncedAt(): Signal<number | null> {
    return computed(() => {
      this._providerVersion();
      return this.active.lastSyncedAt();
    });
  }

  collection<T>(name: string): Signal<T[]> {
    // We can't memoize the returned signal across swaps because each
    // provider owns its own signal. Return a computed that reads
    // through to the active provider. The computed tracks
    // providerVersion so it re-evaluates on swaps.
    return computed(() => {
      this._providerVersion();
      return this.active.collection<T>(name)();
    });
  }

  doc<T>(name: string): Signal<T | null> {
    return computed(() => {
      this._providerVersion();
      return this.active.doc<T>(name)();
    });
  }

  async setRecord<T extends { id: string }>(name: string, value: T): Promise<void> {
    await this.active.setRecord(name, value);
  }

  async removeRecord(name: string, id: string): Promise<void> {
    await this.active.removeRecord(name, id);
  }

  async replaceCollection<T extends { id: string }>(name: string, values: T[]): Promise<void> {
    await this.active.replaceCollection(name, values);
  }

  async setDoc<T>(name: string, value: T): Promise<void> {
    await this.active.setDoc(name, value);
  }

  async removeDoc(name: string): Promise<void> {
    await this.active.removeDoc(name);
  }

  async dispose(): Promise<void> {
    await this.active.dispose();
  }
}
