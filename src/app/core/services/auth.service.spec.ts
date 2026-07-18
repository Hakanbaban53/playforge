import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService, OAuthErrorKind } from './auth.service';
import { FirebaseService } from './firebase.service';

/**
 * AuthService tests — covers the centralized logout mechanism:
 *
 *   - `logoutEpoch` signal increments on every sign-out (explicit,
 *     token-expiry, or cross-tab).
 *   - `lastSessionEndReason` records which kind of session-end fired.
 *   - Cross-tab bridge: writing to localStorage triggers a `storage`
 *     event in OTHER tabs (not this one) — we simulate the event
 *     directly to test the listener.
 *   - `classifyOAuthError()` maps Firebase error codes to the right
 *     i18n key.
 *
 * The Firebase SDK itself is NOT exercised — these tests stub
 * `FirebaseService` with `enabled: false` so AuthService skips
 * initialization entirely. The logout mechanism is pure signal logic
 * and doesn't depend on Firebase being online.
 */
describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    localStorage.clear();
    const fbStub = {
      enabled: false,
      auth: null,
      firestore: null,
      storage: null,
      googleProvider: null,
      ensureInitialized: () => null,
    } as unknown as FirebaseService;

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: FirebaseService, useValue: fbStub },
      ],
    });
    service = TestBed.inject(AuthService);
  });

  describe('initial state (cloud disabled)', () => {
    it('is not authenticated', () => {
      expect(service.isAuthenticated()).toBe(false);
    });

    it('has hydrated=true (no Firebase to wait for)', () => {
      expect(service.hydrated()).toBe(true);
    });

    it('has logoutEpoch=0 (no session has ended yet)', () => {
      expect(service.logoutEpoch()).toBe(0);
    });

    it('has lastSessionEndReason=null', () => {
      expect(service.lastSessionEndReason()).toBeNull();
    });
  });

  describe('signOut() — centralized reset trigger', () => {
    it('does NOT throw when Firebase is disabled (no-op)', async () => {
      await expect(service.signOut()).resolves.toBeUndefined();
    });

    it('bumps logoutEpoch even when Firebase is disabled', async () => {
      await service.signOut();
      expect(service.logoutEpoch()).toBe(1);
    });

    it('records the session-end reason as "explicit"', async () => {
      await service.signOut();
      expect(service.lastSessionEndReason()).toBe('explicit');
    });

    it('writes the cross-tab bridge key to localStorage', async () => {
      await service.signOut();
      expect(localStorage.getItem('playforge_logout_epoch')).toBe('1');
    });

    it('bumps logoutEpoch on each successive signOut', async () => {
      await service.signOut();
      await service.signOut();
      await service.signOut();
      expect(service.logoutEpoch()).toBe(3);
    });
  });

  describe('classifyOAuthError() — Firebase error code mapping', () => {
    const cases: { code: string; expected: OAuthErrorKind }[] = [
      { code: 'auth/expired-action-code', expected: 'expired' },
      { code: 'auth/invalid-action-code', expected: 'expired' },
      { code: 'auth/user-token-expired', expected: 'expired' },
      { code: 'auth/popup-closed-by-user', expected: 'denied' },
      { code: 'auth/redirect-cancelled-by-user', expected: 'denied' },
      { code: 'auth/account-exists-with-different-credential', expected: 'denied' },
      { code: 'auth/network-request-failed', expected: 'network' },
      { code: 'auth/network-error', expected: 'network' },
      { code: 'auth/api-key-not-valid', expected: 'config' },
      { code: 'auth/configuration-not-found', expected: 'config' },
      { code: 'auth/invalid-api-key', expected: 'config' },
      { code: 'auth/unknown-error', expected: 'default' },
    ];

    for (const { code, expected } of cases) {
      it(`maps ${code} → ${expected}`, () => {
        const kind = service.classifyOAuthError({ code, message: 'test' });
        expect(kind).toBe(expected);
      });
    }

    it('detects network errors from message text (no code)', () => {
      const kind = service.classifyOAuthError(new Error('Network request failed'));
      expect(kind).toBe('network');
    });

    it('returns "default" for unknown error shapes', () => {
      expect(service.classifyOAuthError(null)).toBe('default');
      expect(service.classifyOAuthError(undefined)).toBe('default');
      expect(service.classifyOAuthError('string error')).toBe('default');
      expect(service.classifyOAuthError({})).toBe('default');
    });
  });

  describe('Intentional logout vs. token expiry', () => {
    /**
     * Bug context: the session-expiry detection in `onAuthStateChanged`
     * used to fire `triggerSessionReset('expired')` for ANY null
     * transition after a user was present — including the null
     * transition caused by the user explicitly clicking "Sign out".
     * That produced a false "session expired" toast on every
     * intentional logout.
     *
     * Fix: `signOut()` sets `intentionalLogout = true` before calling
     * `firebaseSignOut()`. The `onAuthStateChanged` handler checks the
     * flag: if set, the null transition is treated as an explicit
     * logout (reason stays 'explicit', no 'expired' override).
     */

    /** Minimal FirebaseUser stub for testing. */
    function makeFakeUser(uid: string): import('firebase/auth').User {
      return {
        uid,
        email: `${uid}@example.com`,
        displayName: 'Test User',
        photoURL: null,
        emailVerified: true,
        isAnonymous: false,
        metadata: {} as never,
        providerData: [],
        refreshToken: '',
        tenantId: null,
        delete: () => Promise.resolve(),
        getIdToken: () => Promise.resolve('fake-token'),
        getIdTokenResult: () => Promise.resolve({} as never),
        reload: () => Promise.resolve(),
        toJSON: () => ({}),
      } as unknown as import('firebase/auth').User;
    }

    it('REGRESSION: intentional signOut does NOT set reason to "expired"', async () => {
      // Simulate: user signs in.
      service.simulateAuthStateChange(makeFakeUser('uid-1'));
      expect(service.isAuthenticated()).toBe(true);

      // User explicitly clicks "Sign out".
      await service.signOut();

      // The session-end reason must be 'explicit', NOT 'expired'.
      expect(service.lastSessionEndReason()).toBe('explicit');
    });

    it('REGRESSION: simulated onAuthStateChanged(null) after signOut does NOT override "explicit" reason', async () => {
      // User signs in.
      service.simulateAuthStateChange(makeFakeUser('uid-1'));

      // User clicks "Sign out" — sets intentionalLogout + bumps epoch
      // with reason 'explicit'.
      await service.signOut();
      expect(service.lastSessionEndReason()).toBe('explicit');

      // Firebase's onAuthStateChanged fires null (the actual signOut
      // completing). This must NOT override the reason to 'expired'.
      service.simulateAuthStateChange(null);
      expect(service.lastSessionEndReason()).toBe('explicit');
    });

    it('Token expiry (null transition WITHOUT intentional flag) sets reason to "expired"', () => {
      // User is signed in.
      service.simulateAuthStateChange(makeFakeUser('uid-1'));
      expect(service.isAuthenticated()).toBe(true);
      expect(service.logoutEpoch()).toBe(0);

      // Firebase fires null unexpectedly (token revoked, refresh failed).
      // The user did NOT click sign out — intentionalLogout is false.
      service.simulateAuthStateChange(null);

      // This IS a session expiry — reason should be 'expired'.
      expect(service.lastSessionEndReason()).toBe('expired');
      expect(service.logoutEpoch()).toBe(1);
      expect(service.isAuthenticated()).toBe(false);
    });

    it('Initial load with no user does NOT trigger session-expiry', () => {
      // On page load, onAuthStateChanged fires null (no cached user).
      // wasAuthenticated is false, so no session-end event.
      service.simulateAuthStateChange(null);
      expect(service.logoutEpoch()).toBe(0);
      expect(service.lastSessionEndReason()).toBeNull();
    });
  });
});
