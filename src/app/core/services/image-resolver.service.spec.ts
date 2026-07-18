import { TestBed } from '@angular/core/testing';
import { vi, Mock } from 'vitest';
import 'fake-indexeddb/auto';
import { ImageResolverService } from './image-resolver.service';
import { FirebaseStorageService } from './firebase-storage.service';
import { AuthService } from './auth.service';
import { FileStorageAdapter } from './file-storage.adapter';
import { StubAuthService, InMemoryFileStorageAdapter } from './testing';

/**
 * ImageResolverService auth-gate + cache-clear regression tests.
 *
 * These cover the bug where `resolved-img.component.ts`'s effect calls
 * `image-resolver.service.ts` → `firebase-storage.service.ts` →
 * `getDownloadURL()`, and that request was still in flight at the
 * moment the component was destroyed during logout. The fix has three
 * parts, each tested here:
 *
 *   1. Auth gate: `resolve(fbstorage://...)` returns '' when not
 *      authenticated — skips the doomed Storage call entirely.
 *   2. Cache clearing: `clearCache()` is called on logout, so a
 *      cached URL from user A's session is never reused for user B.
 *   3. In-flight dedup: `resolve()` for the same URL reuses the
 *      in-flight promise (no duplicate Storage calls).
 */
describe('ImageResolverService — auth + cache regression tests', () => {
  let resolver: ImageResolverService;
  let auth: StubAuthService;
  let fbStorage: { resolveUrl: Mock; getBytes: Mock; urlCache: Map<string, string> };

  beforeEach(() => {
    auth = new StubAuthService();
    fbStorage = {
      resolveUrl: vi.fn().mockResolvedValue('https://firebasestorage.example.com/img.png?token=abc'),
      getBytes: vi.fn().mockResolvedValue(null),
      urlCache: new Map(),
    };
    const fileAdapter = new InMemoryFileStorageAdapter();

    TestBed.configureTestingModule({
      providers: [
        ImageResolverService,
        { provide: FileStorageAdapter, useValue: fileAdapter },
        { provide: FirebaseStorageService, useValue: fbStorage },
        { provide: AuthService, useValue: auth },
      ],
    });
    resolver = TestBed.inject(ImageResolverService);
  });

  describe('auth gate', () => {
    it('returns "" for fbstorage:// when not authenticated', async () => {
      auth.setUser(null);
      const url = await resolver.resolve('fbstorage://users/uid-1/images/img-1.png');
      expect(url).toBe('');
      expect(fbStorage.resolveUrl).not.toHaveBeenCalled();
    });

    it('resolves fbstorage:// when authenticated', async () => {
      auth.setUser({ uid: 'uid-1', email: 'a@b.co', displayName: null, photoURL: null, justSignedIn: false });
      const url = await resolver.resolve('fbstorage://users/uid-1/images/img-1.png');
      expect(url).toBe('https://firebasestorage.example.com/img.png?token=abc');
      expect(fbStorage.resolveUrl).toHaveBeenCalledTimes(1);
    });

    it('always resolves idb:// regardless of auth state', async () => {
      auth.setUser(null);
      const url = await resolver.resolve('idb://test-id');
      // InMemoryFileStorageAdapter returns a blob: URL.
      expect(url.startsWith('blob:test/')).toBe(true);
    });

    it('passes through http(s) URLs regardless of auth state', async () => {
      auth.setUser(null);
      const url = await resolver.resolve('https://example.com/a.jpg');
      expect(url).toBe('https://example.com/a.jpg');
    });
  });

  describe('in-flight dedup', () => {
    it('dedupes concurrent resolve() calls for the same fbstorage:// URL', async () => {
      auth.setUser({ uid: 'uid-1', email: 'a@b.co', displayName: null, photoURL: null, justSignedIn: false });
      const url = 'fbstorage://users/uid-1/images/img-1.png';
      const [a, b] = await Promise.all([resolver.resolve(url), resolver.resolve(url)]);
      expect(a).toBe(b);
      expect(fbStorage.resolveUrl).toHaveBeenCalledTimes(1);
    });
  });

  describe('cache clearing on logout', () => {
    it('clearCache() removes cached URLs', async () => {
      auth.setUser({ uid: 'uid-1', email: 'a@b.co', displayName: null, photoURL: null, justSignedIn: false });
      const url = 'fbstorage://users/uid-1/images/img-1.png';
      await resolver.resolve(url);
      expect(resolver.getCached(url)).toBeTruthy();

      resolver.clearCache();
      expect(resolver.getCached(url)).toBe('');
    });

    it('logoutEpoch bump triggers clearCache() via the constructor effect', async () => {
      auth.setUser({ uid: 'uid-1', email: 'a@b.co', displayName: null, photoURL: null, justSignedIn: false });
      const url = 'fbstorage://users/uid-1/images/img-1.png';
      await resolver.resolve(url);
      expect(resolver.getCached(url)).toBeTruthy();

      auth.bumpLogoutEpoch('explicit');
      TestBed.flushEffects();
      // The constructor's effect() should have fired clearCache.
      expect(resolver.getCached(url)).toBe('');
    });

    it('after logout, a cached URL from user A is NOT reused for user B', async () => {
      // User A resolves a URL.
      auth.setUser({ uid: 'uid-A', email: 'a@b.co', displayName: null, photoURL: null, justSignedIn: false });
      const urlA = 'fbstorage://users/uid-A/images/secret.png';
      await resolver.resolve(urlA);

      // User A logs out.
      auth.bumpLogoutEpoch('explicit');
      TestBed.flushEffects();
      auth.setUser(null);

      // User B logs in on the same device and somehow references user A's URL
      // (e.g. via a stale Firestore doc that wasn't migrated). The cache
      // should be empty — the second resolve() should hit Storage fresh,
      // and Storage should reject it because user B doesn't own that path.
      auth.setUser({ uid: 'uid-B', email: 'b@c.co', displayName: null, photoURL: null, justSignedIn: false });
      fbStorage.resolveUrl.mockRejectedValueOnce(new Error('storage/unauthorized'));
      const result = await resolver.resolve(urlA);
      expect(result).toBe('');
    });
  });

  describe('resolveToDataUri() — auth gate', () => {
    it('returns "" for fbstorage:// when not authenticated', async () => {
      auth.setUser(null);
      const dataUri = await resolver.resolveToDataUri('fbstorage://users/uid-1/images/img-1.png');
      expect(dataUri).toBe('');
      expect(fbStorage.getBytes).not.toHaveBeenCalled();
    });
  });
});
