import { Injectable, inject, signal, computed, DestroyRef } from '@angular/core';
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as firebaseSignOut,
  GoogleAuthProvider,
  signInWithCredential,
} from 'firebase/auth';
import { FirebaseService } from './firebase.service';
import { environment } from '../../../environments/environment';

/** Classified OAuth error codes — maps Firebase Auth error codes to
 *  user-friendly message keys consumed by the OAuth callback page. */
export type OAuthErrorKind =
  | 'expired'
  | 'denied'
  | 'network'
  | 'config'
  | 'default';

export interface OAuthCallbackResult {
  idToken: string;
  user: AppUser;
}

/**
 * Reason a session ended. Used by downstream services to decide whether
 * to surface a "session expired" toast (vs. a user-initiated sign-out,
 * which is silent).
 *
 *   - `explicit`    — user clicked "Sign out" in this tab.
 *   - `expired`     — Firebase reported a null user after previously
 *                     having one (token revoked, expired, or revoked by
 *                     the server). Triggers a "session expired" toast.
 *   - `cross-tab`   — another tab signed out; this tab detected it via
 *                     the `storage` event bridge.
 *   - `initial`     — first hydration, no user yet (suppresses toast).
 */
export type SessionEndReason = 'explicit' | 'expired' | 'cross-tab' | 'initial';

/**
 * Authentication service.
 *
 * Wraps Firebase Auth and exposes the current user as a signal. Other
 * services depend on this to know whether to use local storage or cloud
 * storage.
 *
 * Sign-in methods (auto-selected by `useRedirect()`):
 *   - Native Android Google Sign-In via CredentialManager bridge
 *   - Tauri desktop: opens system browser to /oauth-callback, receives
 *     the ID token back via the `playforge://` deep link
 *   - Web: popup (desktop) or redirect (mobile)
 *
 * Centralized logout / session-end:
 *   - `signOut()` calls Firebase signOut and bumps `logoutEpoch`.
 *   - `onAuthStateChanged` detects session expiry (null user after a
 *     previously-authenticated state) and bumps `logoutEpoch` with
 *     reason `expired` — drives a "your session expired" toast.
 *   - A `storage` event listener detects sign-out in other tabs (via
 *     the `playforge_logout_epoch` localStorage key) and bumps
 *     `logoutEpoch` with reason `cross-tab`.
 *   - User-scoped services (InvoiceService, ConfiguratorService,
 *     ImageResolverService, etc.) `effect()` on `logoutEpoch` to clear
 *     their in-memory state. This is the single point of truth for
 *     "the user changed — reset everything user-scoped".
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly fb = inject(FirebaseService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _user = signal<AppUser | null>(null);
  readonly user = this._user.asReadonly();

  readonly isAuthenticated = computed(() => this._user() !== null);

  /** True if Firebase is enabled in environment config. */
  readonly cloudEnabled = this.fb.enabled;

  private readonly _signingIn = signal(false);
  readonly signingIn = this._signingIn.asReadonly();

  private readonly _hydrated = signal(false);
  readonly hydrated = this._hydrated.asReadonly();

  private readonly _justSignedIn = signal(false);
  readonly justSignedIn = this._justSignedIn.asReadonly();

  private readonly _logoutEpoch = signal(0);
  readonly logoutEpoch = this._logoutEpoch.asReadonly();

  private readonly _lastSessionEndReason = signal<SessionEndReason | null>(null);
  readonly lastSessionEndReason = this._lastSessionEndReason.asReadonly();

  private intentionalLogout = false;

  private static readonly CROSS_TAB_KEY = 'playforge_logout_epoch';

  constructor() {
    if (this.fb.enabled) {
      this.init();
      this.setupDeepLinkListener();
      this.setupCrossTabListener();
    } else {
      this._hydrated.set(true);
    }
  }

  private init(): void {
    const auth = this.fb.auth;
    if (!auth) {
      this._hydrated.set(true);
      return;
    }

    onAuthStateChanged(auth, (fbUser) => {
      const wasAuthenticated = this._user() !== null;
      this._user.set(fbUser ? this.project(fbUser) : null);
      this._hydrated.set(true);

      if (!fbUser && wasAuthenticated) {
        if (this.intentionalLogout) {
          this.intentionalLogout = false;
        } else {
          this.triggerSessionReset('expired');
        }
      }
    });

    void getRedirectResult(auth).catch((err) => {
      console.warn('[Auth] Redirect sign-in failed:', err);
      this._signingIn.set(false);
    });
  }

  async signInWithGoogle(): Promise<void> {
    const auth = this.fb.auth;
    if (!auth) {
      console.warn('[Auth] Cannot sign in — Firebase is not initialized.');
      return;
    }

    const androidAuth = (window as unknown as { AndroidAuth?: { signInWithGoogle(clientId: string): void } }).AndroidAuth;
    if (androidAuth) {
      this._signingIn.set(true);
      try {
        const webClientId = environment.firebase.webClientId ?? '';
        await this.signInWithAndroidNative(androidAuth, webClientId);
      } catch (err) {
        console.error('[Auth] Native Android Google Sign-In failed:', err);
      } finally {
        this._signingIn.set(false);
      }
      return;
    }

    const isTauri = typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';
    if (isTauri) {
      this._signingIn.set(true);
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl('https://playforge-hakanbaban53.web.app/oauth-callback');
      } catch (err) {
        console.error('[Auth] Failed to open external browser:', err);
        this._signingIn.set(false);
      }
      return;
    }

    this._signingIn.set(true);
    try {
      if (this.useRedirect()) {
        await signInWithRedirect(auth, this.fb.googleProvider);
        return;
      }
      const result = await signInWithPopup(auth, this.fb.googleProvider);
      if (result.user) {
        this.markJustSignedIn(result.user);
      }
    } catch (err) {
      console.error('[Auth] Sign-in failed:', err);
      throw err;
    } finally {
      this._signingIn.set(false);
    }
  }

  private signInWithAndroidNative(
    androidAuth: { signInWithGoogle(clientId: string): void },
    webClientId: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      interface AndroidBridge {
        onAndroidGoogleSignInSuccess?: (idToken: string) => void;
        onAndroidGoogleSignInError?: (errorMsg: string) => void;
      }
      const win = window as unknown as AndroidBridge & Record<string, unknown>;
      win.onAndroidGoogleSignInSuccess = (idToken: string): void => {
        delete win.onAndroidGoogleSignInSuccess;
        delete win.onAndroidGoogleSignInError;

        const auth = this.fb.auth;
        if (!auth) {
          reject(new Error('Firebase Auth not available'));
          return;
        }

        void (async () => {
          try {
            const credential = GoogleAuthProvider.credential(idToken);
            const result = await signInWithCredential(auth, credential);
            if (result.user) {
              this.markJustSignedIn(result.user);
            }
            resolve();
          } catch (err) {
            console.error('[Auth] Firebase credential sign-in failed:', err);
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        })();
      };

      win.onAndroidGoogleSignInError = (errorMsg: string): void => {
        delete win.onAndroidGoogleSignInSuccess;
        delete win.onAndroidGoogleSignInError;
        console.error('[Auth] Android native Google sign in error:', errorMsg);
        reject(new Error(errorMsg));
      };

      androidAuth.signInWithGoogle(webClientId);
    });
  }

  async signOut(): Promise<void> {
    const auth = this.fb.auth;
    this._justSignedIn.set(false);
    this.intentionalLogout = true;
    this.triggerSessionReset('explicit');
    if (!auth) return;
    try {
      await firebaseSignOut(auth);
    } catch (err) {
      console.error('[Auth] Firebase signOut failed:', err);
      this.intentionalLogout = false;
    }
  }

  private triggerSessionReset(reason: SessionEndReason): void {
    this._lastSessionEndReason.set(reason);
    this._logoutEpoch.update((v) => v + 1);

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(AuthService.CROSS_TAB_KEY, String(this._logoutEpoch()));
      } catch {
        // localStorage may be unavailable (private mode, quota). The
        // in-process signal still fires, so this tab still resets.
      }
    }
  }

  /** Listen for sign-out events from other tabs. */
  private setupCrossTabListener(): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;

    const onStorage = (event: StorageEvent): void => {
      if (event.key !== AuthService.CROSS_TAB_KEY || event.newValue === null) return;
      this._lastSessionEndReason.set('cross-tab');
      this._logoutEpoch.update((v) => v + 1);
      this._user.set(null);
    };

    window.addEventListener('storage', onStorage);
    this.destroyRef.onDestroy(() => window.removeEventListener('storage', onStorage));
  }

  /** Initiate Google sign-in via redirect (used by /oauth-callback). */
  async signInWithGoogleRedirect(): Promise<void> {
    const auth = this.fb.auth;
    if (!auth) {
      throw new Error('Firebase not initialized');
    }
    await signInWithRedirect(auth, this.fb.googleProvider);
  }


  async completeOAuthCallbackFlow(timeoutMs = 8000): Promise<OAuthCallbackResult | null> {
    const auth = this.fb.auth;
    if (!auth) return null;

    if (auth.currentUser) {
      const idToken = await this.safeGetIdToken(auth.currentUser);
      if (idToken) {
        const user = this.project(auth.currentUser);
        this.markJustSignedIn(auth.currentUser);
        return { idToken, user };
      }
      return null;
    }

    try {
      const result = await getRedirectResult(auth);
      if (result?.user) {
        const idToken = await this.safeGetIdToken(result.user);
        if (idToken) {
          const user = this.project(result.user);
          this.markJustSignedIn(result.user);
          return { idToken, user };
        }
      }
    } catch (err) {
      console.warn('[Auth] OAuth callback: redirect result error:', err);
      return null;
    }

    return new Promise<OAuthCallbackResult | null>((resolve) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        unsub();
        resolve(null);
      }, timeoutMs);

      const unsub = onAuthStateChanged(auth, (fbUser) => {
        if (!fbUser || settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        unsub();
        void this.safeGetIdToken(fbUser).then((idToken) => {
          if (!idToken) {
            resolve(null);
            return;
          }
          const user = this.project(fbUser);
          this.markJustSignedIn(fbUser);
          resolve({ idToken, user });
        });
      });
    });
  }

  private async safeGetIdToken(user: FirebaseUser): Promise<string | null> {
    try {
      return await user.getIdToken();
    } catch (err) {
      console.error('[Auth] Failed to get ID token:', err);
      return null;
    }
  }

  private markJustSignedIn(user: FirebaseUser): void {
    this._user.set(this.project(user));
    this._justSignedIn.set(true);
    window.setTimeout(() => this._justSignedIn.set(false), 3000);
  }

  classifyOAuthError(err: unknown): OAuthErrorKind {
    if (!err || typeof err !== 'object') return 'default';
    const code = (err as { code?: string }).code ?? '';
    const message = (err as { message?: string }).message ?? '';

    if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code' || code === 'auth/user-token-expired') {
      return 'expired';
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/redirect-cancelled-by-user' || code === 'auth/account-exists-with-different-credential') {
      return 'denied';
    }
    if (code === 'auth/network-request-failed' || code === 'auth/network-error' || /network/i.test(message)) {
      return 'network';
    }
    if (code === 'auth/api-key-not-valid' || code === 'auth/configuration-not-found' || code === 'auth/invalid-api-key') {
      return 'config';
    }
    return 'default';
  }

  private useRedirect(): boolean {
    if (typeof window === 'undefined') return false;
    const isTauri = typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';
    if (isTauri) return true;
    return window.innerWidth < 768;
  }

  private setupDeepLinkListener(): void {
    const isTauri = typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';
    if (!isTauri) return;

    import('@tauri-apps/plugin-deep-link').then(({ onOpenUrl }) => {
      void onOpenUrl((urls) => {
        for (const urlStr of urls) {
          try {
            const url = new URL(urlStr);
            if (url.protocol === 'playforge:') {
              const token = url.searchParams.get('token') ?? new URLSearchParams(url.search).get('token');
              if (token) {
                void this.signInWithToken(token);
              }
            }
          } catch (e) {
            console.error('[Auth] Failed to parse deep link URL:', urlStr, e);
          }
        }
      });
    }).catch((err) => {
      console.error('[Auth] Failed to load deep-link plugin:', err);
    });
  }

  private async signInWithToken(token: string): Promise<void> {
    const auth = this.fb.auth;
    if (!auth) return;

    this._signingIn.set(true);
    try {
      const credential = GoogleAuthProvider.credential(null, token);
      const result = await signInWithCredential(auth, credential);
      if (result.user) {
        this.markJustSignedIn(result.user);
      }
    } catch (err) {
      console.error('[Auth] Deep link sign-in failed:', err);
    } finally {
      this._signingIn.set(false);
    }
  }

  private project(fbUser: FirebaseUser): AppUser {
    return {
      uid: fbUser.uid,
      email: fbUser.email,
      displayName: fbUser.displayName,
      photoURL: fbUser.photoURL,
      justSignedIn: this._justSignedIn(),
    };
  }

  /**
   * TEST-ONLY: simulate the `onAuthStateChanged` callback firing with
   * the given user (or null). Exposed so tests can exercise the
   * intentional-logout vs. token-expiry distinction without a real
   * Firebase Auth instance. NOT for production use.
   */
  simulateAuthStateChange(fbUser: FirebaseUser | null): void {
    const wasAuthenticated = this._user() !== null;
    this._user.set(fbUser ? this.project(fbUser) : null);
    this._hydrated.set(true);
    if (!fbUser && wasAuthenticated) {
      if (this.intentionalLogout) {
        this.intentionalLogout = false;
      } else {
        this.triggerSessionReset('expired');
      }
    }
  }
}

/** Authenticated user shape — a thin projection of `firebase.User`. */
export interface AppUser {
  readonly uid: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly photoURL: string | null;
  /** True for ~3s after sign-in — used by the merge flow. */
  readonly justSignedIn: boolean;
}
