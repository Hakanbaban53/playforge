import { vi } from 'vitest';
import 'fake-indexeddb/auto';

const mocks = vi.hoisted(() => ({
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
  ref: vi.fn((storage: unknown, path: string) => ({ storage, path })),
}));

vi.mock('firebase/storage', () => ({
  ref: mocks.ref,
  uploadBytes: mocks.uploadBytes,
  getDownloadURL: mocks.getDownloadURL,
  deleteObject: vi.fn(),
  getBytes: vi.fn(),
}));

import { TestBed } from '@angular/core/testing';
import { UploadService } from './upload.service';
import { FirebaseStorageService } from './firebase-storage.service';
import { ImageMappingsService } from './image-mappings.service';
import { ImageSyncQueueService } from './image-sync-queue.service';
import { FirebaseService } from './firebase.service';
import { AuthService } from './auth.service';
import { FileStorageAdapter } from './file-storage.adapter';
import { BrowserFileStorageAdapter } from './browser-file-storage.adapter';
import { StubAuthService } from './testing';

/**
 * UploadService — local-first routing tests.
 *
 * Bug context: the old cloud-first model uploaded to Firebase Storage
 * before returning a ref, which failed offline. The new local-first
 * model always saves to IDB first and returns `idb://` immediately;
 * cloud sync happens in the background via ImageSyncQueueService.
 */
describe('UploadService', () => {
  let service: UploadService;
  let auth: StubAuthService;
  let syncQueue: { enqueueUpload: ReturnType<typeof vi.fn>; enqueueDelete: ReturnType<typeof vi.fn>; removeByLocalId: ReturnType<typeof vi.fn> };
  let mappings: { getCloudPath: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auth = new StubAuthService();

    const fbStub = {
      enabled: true,
      firestore: null,
      storage: {},
      auth: null,
      googleProvider: null,
      ensureInitialized: () => null,
    } as unknown as FirebaseService;

    syncQueue = {
      enqueueUpload: vi.fn().mockResolvedValue(undefined),
      enqueueDelete: vi.fn().mockResolvedValue(undefined),
      removeByLocalId: vi.fn().mockResolvedValue(undefined),
    };
    mappings = {
      getCloudPath: vi.fn().mockReturnValue(undefined),
    };

    TestBed.configureTestingModule({
      providers: [
        UploadService,
        FirebaseStorageService,
        { provide: FirebaseService, useValue: fbStub },
        { provide: AuthService, useValue: auth },
        { provide: FileStorageAdapter, useClass: BrowserFileStorageAdapter },
        { provide: ImageSyncQueueService, useValue: syncQueue },
        { provide: ImageMappingsService, useValue: mappings },
      ],
    });
    service = TestBed.inject(UploadService);

    mocks.uploadBytes.mockReset();
    mocks.getDownloadURL.mockReset();
  });

  function makeImageFile(name = 'photo.png'): File {
    return new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'image/png' });
  }

  it('REGRESSION: upload always saves to local IDB and returns idb:// ref', async () => {
    auth.setUser({ uid: 'uid-1', email: 'a@b.co', displayName: null, photoURL: null, justSignedIn: false });

    const result = await service.upload(makeImageFile());

    // Always returns idb:// ref — never fbstorage://.
    expect(result.url.startsWith('idb://')).toBe(true);
    // No direct cloud upload — sync queue handles that.
    expect(mocks.uploadBytes).not.toHaveBeenCalled();
  });

  it('REGRESSION: upload enqueues cloud sync when signed-in', async () => {
    auth.setUser({ uid: 'uid-1', email: 'a@b.co', displayName: null, photoURL: null, justSignedIn: false });

    await service.upload(makeImageFile());

    expect(syncQueue.enqueueUpload).toHaveBeenCalledTimes(1);
    const payload = syncQueue.enqueueUpload.mock.calls[0][0];
    expect(payload.localId).toBeTruthy();
    expect(payload.bytes).toBeInstanceOf(ArrayBuffer);
    expect(payload.filename).toBe('photo.png');
    expect(payload.mime).toBe('image/png');
  });

  it('REGRESSION: upload does NOT enqueue sync when signed-out', async () => {
    auth.setUser(null);

    await service.upload(makeImageFile());

    expect(syncQueue.enqueueUpload).not.toHaveBeenCalled();
  });

  it('REGRESSION: delete always enqueues cloud delete (cloudPath optional)', async () => {
    auth.setUser({ uid: 'uid-1', email: 'a@b.co', displayName: null, photoURL: null, justSignedIn: false });
    mappings.getCloudPath.mockReturnValue(undefined);

    // First upload to get a local idb:// ref.
    const uploaded = await service.upload(makeImageFile());
    expect(uploaded.url.startsWith('idb://')).toBe(true);

    // Now delete it.
    await service.delete(uploaded.url);

    // Always enqueues delete — cloudPath is undefined when mapping not
    // loaded. The sync queue looks it up at flush time; if no mapping
    // exists, the delete is silently dropped.
    expect(syncQueue.enqueueDelete).toHaveBeenCalledTimes(1);
    const [localId, cloudPath] = syncQueue.enqueueDelete.mock.calls[0];
    expect(localId).toBe(uploaded.url.replace('idb://', ''));
    expect(cloudPath).toBeUndefined();
  });

  it('REGRESSION: delete enqueues cloud delete when mapping exists', async () => {
    auth.setUser({ uid: 'uid-1', email: 'a@b.co', displayName: null, photoURL: null, justSignedIn: false });
    const cloudPath = 'users/uid-1/images/img-existing.png';
    mappings.getCloudPath.mockReturnValue(cloudPath);

    // Delete an idb:// ref that has a mapping.
    await service.delete('idb://local-with-mapping');

    // Mapping exists → enqueueDelete called with localId + cloudPath.
    expect(syncQueue.enqueueDelete).toHaveBeenCalledWith('local-with-mapping', cloudPath);
    expect(syncQueue.removeByLocalId).not.toHaveBeenCalled();
  });

  it('uploadMany processes multiple files', async () => {
    auth.setUser({ uid: 'uid-1', email: 'a@b.co', displayName: null, photoURL: null, justSignedIn: false });

    const files = [makeImageFile('a.png'), makeImageFile('b.png'), makeImageFile('c.png')];
    const results = await service.uploadMany(files);

    expect(results.length).toBe(3);
    expect(syncQueue.enqueueUpload).toHaveBeenCalledTimes(3);
    // Each file gets a unique idb:// ref.
    const urls = new Set(results.map((r) => r.url));
    expect(urls.size).toBe(3);
  });

  it('rejects invalid file types', async () => {
    const badFile = new File([new Uint8Array([1])], 'doc.pdf', { type: 'application/pdf' });
    await expect(service.upload(badFile)).rejects.toThrow('Unsupported file type');
  });

  it('rejects files over 10 MB', async () => {
    const hugeBytes = new Uint8Array(11 * 1024 * 1024);
    const hugeFile = new File([hugeBytes], 'big.png', { type: 'image/png' });
    await expect(service.upload(hugeFile)).rejects.toThrow('File too large');
  });
});
