import { Injectable, inject, signal, computed } from '@angular/core';
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

/**
 * Authenticated user shape — a thin projection of `firebase.User` so the
 * rest of the app doesn't have to import the Firebase SDK directly.
 */
export interface AppUser {
  readonly uid: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly photoURL: string | null;
  /** True for ~3s after sign-in completes — used by the merge flow to
   *  decide whether to prompt the user about uploading local data. */
  readonly justSignedIn: boolean;
}

/**
 * Authentication service.
 *
 * Wraps Firebase Auth and exposes the current user as a signal. Other
 * services depend on this to know whether to use local storage or cloud
 * storage.
 *
 * Sign-in methods:
 *   - Google sign-in via popup (desktop browsers, Tauri webview)
 *   - Google sign-in via redirect (mobile browsers — popups are blocked
 *     on most mobile browsers)
 *
 * The popup-vs-redirect decision is made by `useRedirect()` — currently
 * just a viewport-width check, but could be extended to detect Tauri
 * iOS vs. Android if needed.
 *
 * Sign-out:
 *   - Calls `firebase.auth().signOut()`
 *   - Emits a null `currentUser` signal
 *   - Downstream services (`FirestoreDataProvider`, image cache, etc.)
 *     listen for the signal and clean up their state.
 *
 * "Just signed in" flag:
 *   - Set to `true` for ~3 seconds after sign-in completes
 *   - Used by `FirstLoginMergeService` to decide whether to show the
 *     "Upload your local data?" prompt
 *   - Cleared after the merge prompt is dismissed or 3 seconds elapses
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly fb = inject(FirebaseService);

  private readonly _user = signal<AppUser | null>(null);
  /** Current authenticated user, or `null` if not signed in. */
  readonly user = this._user.asReadonly();

  /** True if the user is currently signed in. */
  readonly isAuthenticated = computed(() => this._user() !== null);

  /** True if Firebase is enabled in environment config. When false,
   *  sign-in is impossible and the app runs in pure-local mode. */
  readonly cloudEnabled = this.fb.enabled;

  /** True while a sign-in attempt is in flight (popup open / redirect pending). */
  private readonly _signingIn = signal(false);
  readonly signingIn = this._signingIn.asReadonly();

  /** True if the auth state has been hydrated from Firebase at least once.
   *  Used to suppress UI flicker on initial page load. */
  private readonly _hydrated = signal(false);
  readonly hydrated = this._hydrated.asReadonly();

  /** True for ~3s after a sign-in completes. Drives the merge-prompt flow. */
  private readonly _justSignedIn = signal(false);

  constructor() {
    if (this.fb.enabled) {
      this.init();
      this.setupDeepLinkListener();
    } else {
      // Cloud disabled — auth state is permanently "logged out".
      this._hydrated.set(true);
    }
  }

  private init(): void {
    const auth = this.fb.auth;
    if (!auth) {
      this._hydrated.set(true);
      return;
    }

    // Listen for auth state changes (sign-in, sign-out, token refresh).
    onAuthStateChanged(auth, (fbUser) => {
      this._user.set(fbUser ? this.project(fbUser) : null);
      this._hydrated.set(true);
    });

    // Handle mobile-redirect sign-in: the redirect returns to the page,
    // then we need to call getRedirectResult to get the user credential.
    // The onAuthStateChanged listener above will fire with the new user.
    void getRedirectResult(auth).catch((err) => {
      console.warn('[Auth] Redirect sign-in failed:', err);
      this._signingIn.set(false);
    });
  }

  /** Trigger Google sign-in. Uses Native Android dialog on Android, system browser on Desktop Tauri, popup in web mode. */
  async signInWithGoogle(): Promise<void> {
    const auth = this.fb.auth;
    if (!auth) {
      console.warn('[Auth] Cannot sign in — Firebase is not initialized.');
      return;
    }

    // 1. Native Android Google Sign-In via CredentialManager
    const androidAuth = (window as unknown as { AndroidAuth?: { signInWithGoogle(clientId: string): void } }).AndroidAuth;
    if (androidAuth) {
      this._signingIn.set(true);
      try {
        const webClientId = (environment.firebase as any).webClientId || '';
        await this.signInWithAndroidNative(androidAuth, webClientId);
      } catch (err) {
        console.error('[Auth] Native Android Google Sign-In failed:', err);
      } finally {
        this._signingIn.set(false);
      }
      return;
    }

    // 2. Desktop Tauri: open default system browser to handle deep-link OAuth
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

    // 3. Web mode: popup or redirect
    this._signingIn.set(true);
    try {
      if (this.useRedirect()) {
        await signInWithRedirect(auth, this.fb.googleProvider);
        return;
      }

      const result = await signInWithPopup(auth, this.fb.googleProvider);
      if (result.user) {
        this._justSignedIn.set(true);
        this._user.set(this.project(result.user));
        window.setTimeout(() => this._justSignedIn.set(false), 3000);
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
    webClientId: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const win = window as any;
      win.onAndroidGoogleSignInSuccess = async (idToken: string) => {
        delete win.onAndroidGoogleSignInSuccess;
        delete win.onAndroidGoogleSignInError;

        const auth = this.fb.auth;
        if (!auth) {
          reject(new Error('Firebase Auth not available'));
          return;
        }

        try {
          const credential = GoogleAuthProvider.credential(idToken);
          const result = await signInWithCredential(auth, credential);
          if (result.user) {
            this._justSignedIn.set(true);
            this._user.set(this.project(result.user));
            window.setTimeout(() => this._justSignedIn.set(false), 3000);
          }
          resolve();
        } catch (err) {
          console.error('[Auth] Firebase credential sign-in failed:', err);
          reject(err);
        }
      };

      win.onAndroidGoogleSignInError = (errorMsg: string) => {
        delete win.onAndroidGoogleSignInSuccess;
        delete win.onAndroidGoogleSignInError;
        console.error('[Auth] Android native Google sign in error:', errorMsg);
        reject(new Error(errorMsg));
      };

      androidAuth.signInWithGoogle(webClientId);
    });
  }

  /** Sign out and clear the local cloud cache. */
  async signOut(): Promise<void> {
    const auth = this.fb.auth;
    if (!auth) return;
    this._justSignedIn.set(false);
    await firebaseSignOut(auth);
    // onAuthStateChanged will fire with null and update the signal.
  }

  /** True if the user just signed in (within the last 3 seconds). Used
   *  by FirstLoginMergeService to decide whether to show the merge prompt. */
  readonly justSignedIn = this._justSignedIn.asReadonly();

  private useRedirect(): boolean {
    if (typeof window === 'undefined') return false;
    
    // In Tauri (both desktop and mobile), always use redirect. Tauri's security model and webview
    // engines block window.open popups by default.
    const isTauri = typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';
    if (isTauri) return true;

    // Mobile browsers block popups, so use redirect there.
    return window.innerWidth < 768;
  }

  private setupDeepLinkListener(): void {
    const isTauri = typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';
    if (!isTauri) return;

    import('@tauri-apps/plugin-deep-link').then(({ onOpenUrl }) => {
      void onOpenUrl((urls) => {
        console.log('[Auth] Deep links received:', urls);
        for (const urlStr of urls) {
          try {
            const url = new URL(urlStr);
            if (url.protocol === 'playforge:') {
              // Non-standard protocols (like playforge://) parse the rest as pathname/search.
              // We retrieve the token from searchParams, or parse the search query as fallback.
              const token = url.searchParams.get('token') || new URLSearchParams(url.search).get('token');
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
        this._justSignedIn.set(true);
        this._user.set(this.project(result.user));
        window.setTimeout(() => this._justSignedIn.set(false), 3000);
      }
    } catch (err) {
      console.error('[Auth] Deep link sign-in failed:', err);
    } finally {
      this._signingIn.set(false);
    }
  }

  /** Project a Firebase User into our app-side AppUser shape. */
  private project(fbUser: FirebaseUser): AppUser {
    return {
      uid: fbUser.uid,
      email: fbUser.email,
      displayName: fbUser.displayName,
      photoURL: fbUser.photoURL,
      // justSignedIn is tracked separately via the _justSignedIn signal;
      // we expose a snapshot here for callers that read AppUser directly.
      // The authoritative value is `AuthService.justSignedIn()`.
      justSignedIn: this._justSignedIn(),
    };
  }
}
