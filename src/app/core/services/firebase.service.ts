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
      } catch {
        // initializeFirestore throws if persistence is already enabled
        // (e.g. Hot Module Reload during dev). Fall back to getFirestore,
        // which returns the existing instance.
        this._firestore = getFirestore(this.app);
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

