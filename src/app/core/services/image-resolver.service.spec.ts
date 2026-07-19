import { TestBed } from '@angular/core/testing';
import { vi, Mock } from 'vitest';
import 'fake-indexeddb/auto';
import { ImageResolverService } from './image-resolver.service';
import { FirebaseStorageService } from './firebase-storage.service';
import { ImageMappingsService } from './image-mappings.service';
import { AuthService } from './auth.service';
import { FileStorageAdapter, StoredFile } from './file-storage.adapter';
import { StubAuthService, InMemoryFileStorageAdapter } from './testing';

/**
 * ImageResolverService — local-first resolution tests.
 *
 * Covers:
 *   - idb:// resolves from local IDB (instant, offline-capable)
 *   - idb:// not in local IDB → mapping → cloud fetch flow
 *   - idb:// not in local IDB, no mapping → '' (no network spam)
 *   - fbstorage:// backward compat (cloud fetch)
 *   - auth gate: cloud fetches only when authenticated
 *   - cache clearing on logout
 *   - in-flight dedup
 */
describe('ImageResolverService', () => {
  let resolver: ImageResolverService;
  let auth: StubAuthService;
  let fileAdapter: InMemoryFileStorageAdapter;
  let fbStorage: { getBytes: Mock };
  let mappings: { getCloudPath: Mock; ensureListener: Mock };

  beforeEach(() => {
    auth = new StubAuthService();
    fileAdapter = new InMemoryFileStorageAdapter();
    fbStorage = {
      getBytes: vi.fn().mockResolvedValue(null),
    };
    mappings = {
      getCloudPath: vi.fn().mockReturnValue(undefined),
      ensureListener: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        ImageResolverService,
        { provide: FileStorageAdapter, useValue: fileAdapter },
        { provide: FirebaseStorageService, useValue: fbStorage },
        { provide: ImageMappingsService, useValue: mappings },
        { provide: AuthService, useValue: auth },
      ],
    });
    resolver = TestBed.inject(ImageResolverService);
  });

  describe('idb:// resolution (local-first)', () => {
    it('resolves from local IDB instantly', async () => {
      // Save an image to local IDB first.
      const file = new File([new Uint8Array([1, 2, 3, 4])], 'photo.png', { type: 'image/png' });
      const stored = await fileAdapter.save(file);
      const ref = `idb://${stored.id}`;

      const url = await resolver.resolve(ref);
      expect(url.startsWith('blob:')).toBe(true);
      // No cloud fetch — local IDB hit.
      expect(fbStorage.getBytes).not.toHaveBeenCalled();
    });

    it('returns "" when not in local IDB and no mapping (no network spam)', async () => {
      auth.setUser(null);
      const url = await resolver.resolve('idb://nonexistent');
      expect(url).toBe('');
      // No cloud fetch attempted (no auth).
      expect(fbStorage.getBytes).not.toHaveBeenCalled();
    });

    it('returns "" when authenticated but no mapping exists', async () => {
      auth.setUser({ uid: 'uid-1', email: 'a@b.co', displayName: null, photoURL: null, justSignedIn: false });
      mappings.getCloudPath.mockReturnValue(undefined);

      const url = await resolver.resolve('idb://nonexistent');
      expect(url).toBe('');
      // Mapping listener was ensured (lazy attach).
      expect(mappings.ensureListener).toHaveBeenCalled();
      // No cloud fetch — no mapping to fetch from.
      expect(fbStorage.getBytes).not.toHaveBeenCalled();
    });

    it('fetches from cloud via mapping when not in local IDB', async () => {
      auth.setUser({ uid: 'uid-1', email: 'a@b.co', displayName: null, photoURL: null, justSignedIn: false });
      const cloudPath = 'users/uid-1/images/img-123.png';
      mappings.getCloudPath.mockReturnValue(cloudPath);
      const cloudBytes = new ArrayBuffer(4);
      fbStorage.getBytes.mockResolvedValue(cloudBytes);

      const url = await resolver.resolve('idb://from-other-device');
      expect(url.startsWith('blob:')).toBe(true);
      expect(mappings.ensureListener).toHaveBeenCalled();
      expect(fbStorage.getBytes).toHaveBeenCalledWith(cloudPath);
    });

    it('REGRESSION: cross-device image is cached in local IDB for future resolves', async () => {
      // Bug: cloud-fetched images weren't saved to IDB, so every page
      // reload re-fetched from cloud. Fix: saveWithId caches them.
      auth.setUser({ uid: 'uid-1', email: 'a@b.co', displayName: null, photoURL: null, justSignedIn: false });
      const cloudPath = 'users/uid-1/images/img-cache.png';
      mappings.getCloudPath.mockReturnValue(cloudPath);
      const cloudBytes = new TextEncoder().encode('cloud-image-bytes').buffer as ArrayBuffer;
      fbStorage.getBytes.mockResolvedValue(cloudBytes);

      const localId = 'cross-device-cache-test';
      const ref = `idb://${localId}`;

      // First resolve — fetches from cloud.
      const url1 = await resolver.resolve(ref);
      expect(url1.startsWith('blob:')).toBe(true);
      expect(fbStorage.getBytes).toHaveBeenCalledTimes(1);

      // Verify the bytes were saved to local IDB via saveWithId.
      const stored: StoredFile = { id: localId, name: '', mimeType: '', size: 0 };
      const cachedBytes = await fileAdapter.readBytes(stored);
      expect(cachedBytes).toBeTruthy();
      expect(cachedBytes!.byteLength).toBe(cloudBytes.byteLength);
    });
  });

  describe('fbstorage:// backward compat', () => {
    it('returns "" when not authenticated', async () => {
      auth.setUser(null);
      const url = await resolver.resolve('fbstorage://users/uid-1/images/img-1.png');
      expect(url).toBe('');
      expect(fbStorage.getBytes).not.toHaveBeenCalled();
    });

    it('fetches from cloud when authenticated', async () => {
      auth.setUser({ uid: 'uid-1', email: 'a@b.co', displayName: null, photoURL: null, justSignedIn: false });
      fbStorage.getBytes.mockResolvedValue(new ArrayBuffer(4));

      const url = await resolver.resolve('fbstorage://users/uid-1/images/img-1.png');
      expect(url.startsWith('blob:')).toBe(true);
      expect(fbStorage.getBytes).toHaveBeenCalledWith('users/uid-1/images/img-1.png');
    });
  });

  describe('passthrough', () => {
    it('passes through https URLs', async () => {
      auth.setUser(null);
      const url = await resolver.resolve('https://example.com/a.jpg');
      expect(url).toBe('https://example.com/a.jpg');
    });

    it('passes through data: URIs', async () => {
      auth.setUser(null);
      const url = await resolver.resolve('data:image/png;base64,abc');
      expect(url).toBe('data:image/png;base64,abc');
    });
  });

  describe('in-flight dedup', () => {
    it('dedupes concurrent resolve() calls for the same idb:// URL', async () => {
      const file = new File([new Uint8Array([1])], 'p.png', { type: 'image/png' });
      const stored = await fileAdapter.save(file);
      const ref = `idb://${stored.id}`;

      const [a, b] = await Promise.all([resolver.resolve(ref), resolver.resolve(ref)]);
      expect(a).toBe(b);
    });
  });

  describe('cache clearing on logout', () => {
    it('clearCache() removes cached URLs', async () => {
      const file = new File([new Uint8Array([1])], 'p.png', { type: 'image/png' });
      const stored = await fileAdapter.save(file);
      const ref = `idb://${stored.id}`;

      await resolver.resolve(ref);
      expect(resolver.getCached(ref)).toBeTruthy();

      resolver.clearCache();
      expect(resolver.getCached(ref)).toBe('');
    });

    it('logoutEpoch bump triggers clearCache() via the constructor effect', async () => {
      const file = new File([new Uint8Array([1])], 'p.png', { type: 'image/png' });
      const stored = await fileAdapter.save(file);
      const ref = `idb://${stored.id}`;

      await resolver.resolve(ref);
      expect(resolver.getCached(ref)).toBeTruthy();

      auth.bumpLogoutEpoch('explicit');
      TestBed.flushEffects();
      expect(resolver.getCached(ref)).toBe('');
    });
  });
});
