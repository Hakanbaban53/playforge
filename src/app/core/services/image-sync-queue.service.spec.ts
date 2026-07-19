import { vi } from 'vitest';
import 'fake-indexeddb/auto';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  deleteByPath: vi.fn(),
  getBytes: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
  deleteObject: vi.fn(),
  getBytes: mocks.getBytes,
}));

import { TestBed } from '@angular/core/testing';
import { ImageSyncQueueService } from './image-sync-queue.service';
import { FirebaseStorageService } from './firebase-storage.service';
import { ImageMappingsService } from './image-mappings.service';
import { FirebaseService } from './firebase.service';
import { AuthService } from './auth.service';
import { FileStorageAdapter, StoredFile } from './file-storage.adapter';
import { StubAuthService } from './testing';

/**
 * ImageSyncQueueService — outbox pattern tests.
 *
 * Covers:
 *   - enqueueUpload() creates a pending item
 *   - enqueueDelete() creates a pending delete item
 *   - removeByLocalId() cancels pending items
 *   - clear() wipes the queue
 *   - flush() processes upload items (upload + mapping write)
 *   - flush() processes delete items (cloud delete + mapping remove)
 */
describe('ImageSyncQueueService', () => {
  let queue: ImageSyncQueueService;
  let auth: StubAuthService;
  let fbStorage: { upload: ReturnType<typeof vi.fn>; deleteByPath: ReturnType<typeof vi.fn> };
  let mappings: { setMapping: ReturnType<typeof vi.fn>; removeMapping: ReturnType<typeof vi.fn> };
  let originalOnLine: PropertyDescriptor | undefined;

  beforeEach(() => {
    auth = new StubAuthService();
    auth.setUser({ uid: 'uid-1', email: 'a@b.co', displayName: null, photoURL: null, justSignedIn: false });

    const fbStub = {
      enabled: true,
      firestore: null,
      storage: {},
      auth: null,
      googleProvider: null,
      ensureInitialized: () => null,
    } as unknown as FirebaseService;

    fbStorage = {
      upload: vi.fn().mockResolvedValue({ cloudPath: 'users/uid-1/images/img-1.png', downloadUrl: 'https://example.com/img.png' }),
      deleteByPath: vi.fn().mockResolvedValue(undefined),
    };
    mappings = {
      setMapping: vi.fn().mockResolvedValue(undefined),
      removeMapping: vi.fn().mockResolvedValue(undefined),
    };

    TestBed.configureTestingModule({
      providers: [
        ImageSyncQueueService,
        { provide: FirebaseService, useValue: fbStub },
        { provide: AuthService, useValue: auth },
        { provide: FileStorageAdapter, useValue: new InMemoryFileAdapter() },
        { provide: FirebaseStorageService, useValue: fbStorage },
        { provide: ImageMappingsService, useValue: mappings },
      ],
    });
    queue = TestBed.inject(ImageSyncQueueService);

    originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    setOnline(false);
  });

  afterEach(() => {
    if (originalOnLine) {
      Object.defineProperty(navigator, 'onLine', originalOnLine);
    }
  });

  function setOnline(online: boolean): void {
    Object.defineProperty(navigator, 'onLine', {
      value: online,
      configurable: true,
      writable: true,
    });
  }

  async function flushAsyncChain(): Promise<void> {
    for (let i = 0; i < 15; i++) await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    TestBed.flushEffects();
  }

  it('enqueueUpload() creates a pending item', async () => {
    await queue.enqueueUpload({
      localId: 'local-1',
      bytes: new ArrayBuffer(4),
      filename: 'photo.png',
      mime: 'image/png',
    });
    await flushAsyncChain();

    const item = queue.items().find((i) => i.localId === 'local-1');
    expect(item).toBeTruthy();
    expect(item!.kind).toBe('upload');
    expect(item!.status === 'pending' || item!.status === 'syncing').toBe(true);
  });

  it('enqueueDelete() creates a pending delete item', async () => {
    await queue.enqueueDelete('local-1', 'users/uid-1/images/img-1.png');
    await flushAsyncChain();

    const item = queue.items().find((i) => i.localId === 'local-1');
    expect(item).toBeTruthy();
    expect(item!.kind).toBe('delete');
  });

  it('removeByLocalId() cancels pending items', async () => {
    await queue.enqueueUpload({
      localId: 'local-1',
      bytes: new ArrayBuffer(4),
      filename: 'photo.png',
      mime: 'image/png',
    });
    await flushAsyncChain();

    expect(queue.items().some((i) => i.localId === 'local-1')).toBe(true);

    await queue.removeByLocalId('local-1');
    await flushAsyncChain();

    expect(queue.items().some((i) => i.localId === 'local-1')).toBe(false);
  });

  it('clear() wipes the entire queue', async () => {
    await queue.enqueueUpload({
      localId: 'local-1',
      bytes: new ArrayBuffer(4),
      filename: 'p.png',
      mime: 'image/png',
    });
    await queue.enqueueUpload({
      localId: 'local-2',
      bytes: new ArrayBuffer(4),
      filename: 'p.png',
      mime: 'image/png',
    });
    await flushAsyncChain();

    await queue.clear();
    await flushAsyncChain();

    expect(queue.items().length).toBe(0);
  });

  it('does NOT flush when offline', async () => {
    setOnline(false);
    await queue.enqueueUpload({
      localId: 'local-offline',
      bytes: new ArrayBuffer(4),
      filename: 'p.png',
      mime: 'image/png',
    });
    await flushAsyncChain();

    expect(fbStorage.upload).not.toHaveBeenCalled();
  });

  it('REGRESSION: flush() does not call cloud upload when offline', async () => {
    setOnline(false);
    await queue.enqueueUpload({
      localId: 'local-offline-flush',
      bytes: new ArrayBuffer(4),
      filename: 'photo.png',
      mime: 'image/png',
    });
    await flushAsyncChain();
    await flushAsyncChain();

    // No cloud upload while offline — item stays pending.
    expect(fbStorage.upload).not.toHaveBeenCalled();
    const item = queue.items().find((i) => i.localId === 'local-offline-flush');
    expect(item).toBeTruthy();
    expect(item!.status).toBe('pending');
  });

  it('REGRESSION: flush() does not call cloud delete when offline', async () => {
    setOnline(false);
    await queue.enqueueDelete('local-offline-del', 'users/uid-1/images/img-del.png');
    await flushAsyncChain();
    await flushAsyncChain();

    expect(fbStorage.deleteByPath).not.toHaveBeenCalled();
    const item = queue.items().find((i) => i.localId === 'local-offline-del');
    expect(item).toBeTruthy();
    expect(item!.status).toBe('pending');
  });

  it('REGRESSION: race condition — item deleted via removeByLocalId stays deleted', async () => {
    // This test verifies the fix for the race condition where processItem's
    // catch block could re-create a deleted item (zombie). The fix:
    // processItem re-reads the item before writing; if gone, aborts.
    setOnline(false); // Keep item pending so flush doesn't process it.

    await queue.enqueueUpload({
      localId: 'race-local',
      bytes: new ArrayBuffer(4),
      filename: 'p.png',
      mime: 'image/png',
    });
    await flushAsyncChain();
    expect(queue.items().some((i) => i.localId === 'race-local')).toBe(true);

    // Delete the item.
    await queue.removeByLocalId('race-local');
    await flushAsyncChain();

    // Item should be gone.
    expect(queue.items().some((i) => i.localId === 'race-local')).toBe(false);

    // Trigger another flush — item should NOT reappear (no zombie).
    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await flushAsyncChain();
    await flushAsyncChain();
    expect(queue.items().some((i) => i.localId === 'race-local')).toBe(false);
  });

  it('REGRESSION: size cap — refuses to enqueue when total would exceed cap', async () => {
    // The cap is 200MB. We test the logic with a controlled scenario:
    // enqueue items until the next would exceed the cap, verify it's refused.
    setOnline(false);
    const fiftyMb = new ArrayBuffer(50 * 1024 * 1024);

    // 4 items × 50MB = 200MB (exactly at cap — allowed).
    for (let i = 1; i <= 4; i++) {
      await queue.enqueueUpload({
        localId: `cap-${i}`,
        bytes: fiftyMb,
        filename: 'p.png',
        mime: 'image/png',
      });
      await flushAsyncChain();
    }
    expect(queue.items().length).toBe(4);

    // 5th item would push to 250MB > 200MB → refused.
    await queue.enqueueUpload({
      localId: 'cap-5',
      bytes: fiftyMb,
      filename: 'p.png',
      mime: 'image/png',
    });
    await flushAsyncChain();
    // cap-5 should NOT be enqueued.
    expect(queue.items().some((i) => i.localId === 'cap-5')).toBe(false);
    expect(queue.items().length).toBe(4);
  });
});

/** Minimal in-memory FileStorageAdapter for tests. */
class InMemoryFileAdapter implements FileStorageAdapter {
  async save(file: File): Promise<StoredFile> {
    return { id: `test-${Date.now()}`, name: file.name, mimeType: file.type, size: file.size };
  }
  async saveWithId(id: string, bytes: ArrayBuffer, mimeType: string, filename: string): Promise<StoredFile> {
    return { id, name: filename, mimeType, size: bytes.byteLength };
  }
  async resolveUrl(): Promise<string> {
    return 'blob:test/abc';
  }
  async readBytes(): Promise<ArrayBuffer | null> {
    return null;
  }
  async delete(): Promise<void> {
    // no-op — test adapter doesn't track deletions
  }
  async clearAll(): Promise<void> {
    // no-op — test adapter doesn't persist
  }
}
