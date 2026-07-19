import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  collection: vi.fn(),
  doc: vi.fn(),
  onSnapshot: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: mocks.collection,
  doc: mocks.doc,
  onSnapshot: mocks.onSnapshot,
  setDoc: mocks.setDoc,
  deleteDoc: mocks.deleteDoc,
}));

import { TestBed } from '@angular/core/testing';
import { ImageMappingsService } from './image-mappings.service';
import { FirebaseService } from './firebase.service';
import { AuthService } from './auth.service';
import { StubAuthService } from './testing';

/**
 * ImageMappingsService — in-memory map + Firestore sync tests.
 *
 * Covers:
 *   - getCloudPath() returns undefined for unknown localId
 *   - setMapping() writes to Firestore
 *   - removeMapping() deletes from Firestore
 *   - onSnapshot listener keeps in-memory map in sync
 *   - clear on logout
 */
describe('ImageMappingsService', () => {
  let service: ImageMappingsService;
  let auth: StubAuthService;
  let onSnapshotCallback: ((snap: { forEach: (cb: (d: { id: string; data: () => unknown }) => void) => void }) => void) | null;

  beforeEach(() => {
    auth = new StubAuthService();
    auth.setUser({ uid: 'uid-1', email: 'a@b.co', displayName: null, photoURL: null, justSignedIn: false });
    onSnapshotCallback = null;

    const fbStub = {
      enabled: true,
      firestore: {},
      storage: null,
      auth: null,
      googleProvider: null,
      ensureInitialized: () => null,
    } as unknown as FirebaseService;

    mocks.collection.mockReturnValue({});
    mocks.doc.mockReturnValue({});
    mocks.setDoc.mockReset().mockResolvedValue(undefined);
    mocks.deleteDoc.mockReset().mockResolvedValue(undefined);
    mocks.onSnapshot.mockImplementation((_ref, cb) => {
      onSnapshotCallback = cb;
      return () => undefined;
    });

    TestBed.configureTestingModule({
      providers: [
        ImageMappingsService,
        { provide: FirebaseService, useValue: fbStub },
        { provide: AuthService, useValue: auth },
      ],
    });
    service = TestBed.inject(ImageMappingsService);
  });

  it('getCloudPath() returns undefined for unknown localId', () => {
    expect(service.getCloudPath('unknown')).toBeUndefined();
  });

  it('setMapping() writes to Firestore', async () => {
    await service.setMapping('local-1', 'users/uid-1/images/img-1.png');
    expect(mocks.setDoc).toHaveBeenCalledTimes(1);
  });

  it('removeMapping() deletes from Firestore', async () => {
    await service.removeMapping('local-1');
    expect(mocks.deleteDoc).toHaveBeenCalledTimes(1);
  });

  it('onSnapshot listener updates in-memory map', () => {
    service.ensureListener();
    TestBed.flushEffects();

    // Simulate onSnapshot emitting with two mapping docs.
    expect(onSnapshotCallback).toBeTruthy();
    onSnapshotCallback!({
      forEach: (cb) => {
        cb({ id: 'local-1', data: () => ({ cloudPath: 'users/uid-1/images/a.png' }) });
        cb({ id: 'local-2', data: () => ({ cloudPath: 'users/uid-1/images/b.png' }) });
      },
    });

    expect(service.getCloudPath('local-1')).toBe('users/uid-1/images/a.png');
    expect(service.getCloudPath('local-2')).toBe('users/uid-1/images/b.png');
    expect(service.getCloudPath('local-3')).toBeUndefined();
  });

  it('clears in-memory map on logout', () => {
    service.ensureListener();
    TestBed.flushEffects();

    onSnapshotCallback!({
      forEach: (cb) => {
        cb({ id: 'local-1', data: () => ({ cloudPath: 'users/uid-1/images/a.png' }) });
      },
    });
    expect(service.getCloudPath('local-1')).toBe('users/uid-1/images/a.png');

    auth.bumpLogoutEpoch('explicit');
    TestBed.flushEffects();

    expect(service.getCloudPath('local-1')).toBeUndefined();
  });
});
