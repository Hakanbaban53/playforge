import { Injectable } from '@angular/core';
import { initializeApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  Auth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import {
  getFirestore,
  Firestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  disableNetwork,
  enableNetwork,
} from 'firebase/firestore';
import {
  getStorage,
  FirebaseStorage as FirebaseStorageType,
} from 'firebase/storage';
import { environment } from '../../../environments/environment';

/**
 * Firebase SDK holder — initialized exactly once, lazily.
 *
 * The first call to `ensureInitialized()` (typically from `AuthService`'s
 * constructor) reads `environment.firebase.enabled`:
 *
 *   - If `false`: every method returns `null`. No SDK is loaded. The app
 *     runs in pure-local mode with no references to Firebase in the
 *     runtime bundle (tree-shaken).
 *
 *   - If `true`: initializes Auth, Firestore (with offline persistence),
 *     and Storage. The returned singletons are then available to whoever
 *     injects this service.
 *
 * Why a separate service (vs. initializing in app.config.ts)?
 *   - We want the SDK to be lazy — if `enabled: false`, we never even
 *     call `initializeApp`, which means the firebase bundle is smaller.
 *   - Tests can stub this service to avoid hitting real Firebase.
 *   - Tauri mode might want a different initialization (e.g. custom
 *     auth domain for deep-link OAuth).
 *
 * Firestore offline persistence:
 *   - `persistentLocalCache` + `persistentMultipleTabManager` keeps a
 *     local IndexedDB cache that survives reloads and syncs across tabs.
 *   - This is what makes Firestore the local store when logged in — the
 *     user's data lives in this cache and is mirrored to the cloud.
 *   - On logout, `clearPersistence()` wipes this cache (see AuthService).
 */
@Injectable({ providedIn: 'root' })
export class FirebaseService {
  private app: FirebaseApp | null = null;
  private _auth: Auth | null = null;
  private _firestore: Firestore | null = null;
  private _storage: FirebaseStorageType | null = null;
  private _initialized = false;

  /**
   * Single source of truth for the Firestore network state.
   *
   * `true` when the network has been explicitly disabled (offline).
   * `FirestoreDataProvider` reads this instead of maintaining its own
   * flag — avoids two independent states drifting out of sync.
   *
   * Initialized to match `navigator.onLine` at construction time. If
   * the app launches offline, `ensureInitialized()` calls
   * `disableNetwork()` immediately (before any onSnapshot attaches).
   */
  private _networkDisabled = typeof navigator !== 'undefined' && !navigator.onLine;

  /** True if the Firestore network is currently disabled (offline). */
  get networkDisabled(): boolean {
    return this._networkDisabled;
  }

  /** True if `environment.firebase.enabled` is `true` AND initialization
   *  succeeded. Use this to gate cloud-only UI. */
  readonly enabled = environment.firebase.enabled === true;

  /** Initialize the Firebase app and its sub-services. Idempotent.
   *  Returns `null` if cloud features are disabled. */
  ensureInitialized(): FirebaseApp | null {
    if (!this.enabled) return null;
    if (this._initialized) return this.app;
    this._initialized = true;

    try {
      this.app = initializeApp(environment.firebase);

      // Auth: persist sessions across reloads (default behavior, but
      // explicit so a future SDK upgrade doesn't silently change it).
      this._auth = getAuth(this.app);
      void setPersistence(this._auth, browserLocalPersistence);

      // Firestore: enable offline persistence so the app works offline
      // and serves cached data immediately on launch. The multi-tab
      // manager keeps the cache consistent across browser tabs.
      try {
        this._firestore = initializeFirestore(this.app, {
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
        });
      } catch (err) {
        // initializeFirestore throws if the Firestore instance for this
        // app already exists (e.g. Hot Module Reload during dev).
        // getFirestore() returns that existing instance.
        console.warn('[Firebase] initializeFirestore fell back to getFirestore:', err);
        this._firestore = getFirestore(this.app);
      }

      // If the app launches while offline, disable the Firestore network
      // IMMEDIATELY — before any onSnapshot listener can attach. This
      // prevents the SDK from trying to open the Listen stream, which
      // would spam "transport errored" warnings until disableNetwork()
      // takes effect.
      if (this._networkDisabled) {
        void disableNetwork(this._firestore).catch((err) => {
          console.warn('[Firebase] Initial disableNetwork failed:', err);
        });
      }

      this._storage = getStorage(this.app);
    } catch (err) {
      console.error('[Firebase] Initialization failed:', err);
      this.app = null;
      this._auth = null;
      this._firestore = null;
      this._storage = null;
    }

    return this.app;
  }

  /**
   * Enable or disable the Firestore SDK's network connection. Single
   * source of truth — `FirestoreDataProvider` delegates here instead
   * of maintaining its own flag.
   *
   * When disabled, the SDK serves reads from the local cache and
   * queues writes locally — `setDoc()` / `deleteDoc()` promises
   * resolve immediately after the local IndexedDB commit, with no
   * retry-loop delay.
   */
  async setNetworkEnabled(enabled: boolean): Promise<void> {
    if (!this._firestore) return;

    if (enabled && this._networkDisabled) {
      try {
        await enableNetwork(this._firestore);
        this._networkDisabled = false;
      } catch (err) {
        console.warn('[Firebase] enableNetwork failed:', err);
      }
    } else if (!enabled && !this._networkDisabled) {
      try {
        await disableNetwork(this._firestore);
        this._networkDisabled = true;
      } catch (err) {
        console.warn('[Firebase] disableNetwork failed:', err);
      }
    }
  }

  get auth(): Auth | null {
    this.ensureInitialized();
    return this._auth;
  }

  get firestore(): Firestore | null {
    this.ensureInitialized();
    return this._firestore;
  }

  get storage(): FirebaseStorageType | null {
    this.ensureInitialized();
    return this._storage;
  }

  /** Shared Google Auth provider instance. */
  readonly googleProvider = new GoogleAuthProvider();
}

