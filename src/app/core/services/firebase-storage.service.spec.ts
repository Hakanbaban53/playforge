import { TestBed } from '@angular/core/testing';
import { FirebaseStorageService, parseFirebaseStorageRef, buildFirebaseStorageRef } from './firebase-storage.service';
import { FirebaseService } from './firebase.service';
import { AuthService } from './auth.service';
import { StubAuthService } from './testing';

/**
 * FirebaseStorageService tests — covers the URL-parsing helpers and
 * the offline/unavailable error paths.
 *
 * The Storage SDK itself (`getDownloadURL`, `uploadBytes`, `getBytes`)
 * is NOT exercised here — that requires a real Firebase project.
 * Instead, these tests stub `FirebaseService.storage` to null so the
 * service short-circuits to its error paths, which we CAN verify.
 */
describe('FirebaseStorageService', () => {
  describe('parseFirebaseStorageRef()', () => {
    it('parses a valid fbstorage:// URL', () => {
      const result = parseFirebaseStorageRef('fbstorage://users/uid-1/images/img-1.png');
      expect(result).toEqual({ path: 'users/uid-1/images/img-1.png' });
    });

    it('returns null for non-fbstorage URLs', () => {
      expect(parseFirebaseStorageRef('https://example.com/img.png')).toBeNull();
      expect(parseFirebaseStorageRef('idb://abc-123')).toBeNull();
      expect(parseFirebaseStorageRef('data:image/png;base64,abc')).toBeNull();
      expect(parseFirebaseStorageRef('')).toBeNull();
    });
  });

  describe('buildFirebaseStorageRef()', () => {
    it('builds a fbstorage:// URL from a path', () => {
      expect(buildFirebaseStorageRef('users/uid-1/images/img-1.png'))
        .toBe('fbstorage://users/uid-1/images/img-1.png');
    });

    it('round-trips through parseFirebaseStorageRef()', () => {
      const path = 'users/uid-1/images/img-1.png';
      const ref = buildFirebaseStorageRef(path);
      expect(parseFirebaseStorageRef(ref)).toEqual({ path });
    });
  });

  describe('Service behavior (with Firebase disabled)', () => {
    let service: FirebaseStorageService;
    let auth: StubAuthService;

    beforeEach(() => {
      auth = new StubAuthService();
      // Stub FirebaseService with `storage: null` and `enabled: false`
      // so the service short-circuits to error paths.
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
          FirebaseStorageService,
          { provide: FirebaseService, useValue: fbStub },
          { provide: AuthService, useValue: auth },
        ],
      });
      service = TestBed.inject(FirebaseStorageService);
    });

    it('getBytes() returns null when Firebase storage is unavailable', async () => {
      const bytes = await service.getBytes('users/uid-1/images/img-1.png');
      expect(bytes).toBeNull();
    });

    it('available is false when Firebase is disabled', () => {
      expect(service.available).toBe(false);
    });

    it('upload() throws when not signed in', async () => {
      await expect(service.upload(new File([new Uint8Array([1])], 'p.png', { type: 'image/png' })))
        .rejects.toThrow('Not signed in');
    });

    it('deleteByPath() is a no-op when Firebase storage is unavailable', async () => {
      await expect(service.deleteByPath('users/uid-1/images/img-1.png')).resolves.toBeUndefined();
    });
  });
});
