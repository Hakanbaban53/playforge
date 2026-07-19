import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { FileStorageAdapter } from './file-storage.adapter';
import { BrowserFileStorageAdapter } from './browser-file-storage.adapter';
import { ImageResolverService } from './image-resolver.service';
import { FirebaseStorageService } from './firebase-storage.service';
import { ImageMappingsService } from './image-mappings.service';
import { AuthService } from './auth.service';
import { parseStoredFileRef } from './file-storage.adapter';

/**
 * FileStorageAdapter + ImageResolverService tests.
 *
 * Verifies the client-side file storage abstraction that replaces the
 * previous server-side upload endpoint. Files are persisted to IndexedDB
 * and resolved to blob: URLs on demand. This is the foundation for the
 * future Tauri migration — the Tauri adapter will implement the same
 * interface using Tauri's `fs` plugin.
 */
describe('FileStorageAdapter (BrowserFileStorageAdapter)', () => {
  let adapter: FileStorageAdapter;

  // Fresh adapter per test — no TestBed, no shared state, no DB-delete race.
  beforeEach(() => {
    adapter = new BrowserFileStorageAdapter();
  });

  afterEach(() => {
    adapter = null as never;
  });

  function makeImageFile(name = 'test.png', content = 'png-bytes'): File {
    const blob = new Blob([content], { type: 'image/png' });
    return new File([blob], name, { type: 'image/png' });
  }

  it('saves a file and returns metadata', async () => {
    const file = makeImageFile('photo.png', 'hello');
    const stored = await adapter.save(file);
    expect(stored.id).toMatch(/^idb-/);
    expect(stored.name).toBe('photo.png');
    expect(stored.mimeType).toBe('image/png');
    expect(stored.size).toBe(file.size);
  });

  it('resolveUrl returns a usable blob: URL', async () => {
    const file = makeImageFile('photo.png', 'hello');
    const stored = await adapter.save(file);
    const url = await adapter.resolveUrl(stored);
    expect(url).toMatch(/^blob:/);
  });

  it('resolveUrl caches the blob URL (same id → same URL)', async () => {
    const file = makeImageFile('photo.png', 'hello');
    const stored = await adapter.save(file);
    const url1 = await adapter.resolveUrl(stored);
    const url2 = await adapter.resolveUrl(stored);
    expect(url1).toBe(url2);
  });

  it('readBytes returns the original file content', async () => {
    const file = makeImageFile('photo.png', 'hello-world');
    const stored = await adapter.save(file);
    const bytes = await adapter.readBytes(stored);
    expect(bytes).not.toBeNull();
    const text = new TextDecoder().decode(bytes!);
    expect(text).toBe('hello-world');
  });

  it('readBytes returns null after delete', async () => {
    const file = makeImageFile('photo.png', 'hello');
    const stored = await adapter.save(file);
    await adapter.delete(stored);
    const bytes = await adapter.readBytes(stored);
    expect(bytes).toBeNull();
  });

  it('survives page reload simulation (id is stable, blob persists in IDB)', async () => {
    const file = makeImageFile('photo.png', 'persistent-content');
    const stored = await adapter.save(file);

    // Simulate a new adapter instance (page reload).
    const fresh = new BrowserFileStorageAdapter();
    const bytes = await fresh.readBytes(stored);
    expect(bytes).not.toBeNull();
    expect(new TextDecoder().decode(bytes!)).toBe('persistent-content');
  });
});

describe('parseStoredFileRef', () => {
  it('parses idb:// URLs', () => {
    expect(parseStoredFileRef('idb://abc-123')).toEqual({ kind: 'idb', id: 'abc-123' });
  });

  it('returns null for non-idb URLs', () => {
    expect(parseStoredFileRef('https://example.com/a.jpg')).toBeNull();
    expect(parseStoredFileRef('data:image/png;base64,abc')).toBeNull();
    expect(parseStoredFileRef('blob:http://localhost/abc')).toBeNull();
    expect(parseStoredFileRef('')).toBeNull();
    expect(parseStoredFileRef(undefined as never)).toBeNull();
  });
});

describe('ImageResolverService', () => {
  let resolver: ImageResolverService;
  let adapter: FileStorageAdapter;

  /**
   * Stub AuthService for the ImageResolverService — the auth gate
   * requires `isAuthenticated()` to return true for fbstorage://
   * resolution to proceed. These tests don't actually hit Firebase
   * Storage, so we return `true` and provide a stub `logoutEpoch`
   * signal so the constructor's `effect()` doesn't fail.
   */
  const authStub = {
    isAuthenticated: () => true,
    logoutEpoch: () => 0,
  } as Partial<AuthService>;

  /**
   * Stub FirebaseStorageService — these tests only exercise idb://
   * and passthrough URLs, so the fbstorage:// path is never reached.
   * The stub is here only so DI can construct ImageResolverService.
   */
  const fbStorageStub = {
    getBytes: () => Promise.resolve(null),
  } as Partial<FirebaseStorageService>;
  const mappingsStub = {
    getCloudPath: () => undefined,
    ensureListener: () => undefined,
  } as Partial<ImageMappingsService>;

  // Use a fresh adapter instance (not from TestBed) so we can guarantee
  // it's destroyed after each test — avoiding lingering IDB connections
  // that block deleteDatabase in subsequent tests.
  beforeEach(() => {
    adapter = new BrowserFileStorageAdapter();
    TestBed.configureTestingModule({
      providers: [
        ImageResolverService,
        { provide: FileStorageAdapter, useValue: adapter },
        { provide: FirebaseStorageService, useValue: fbStorageStub },
        { provide: ImageMappingsService, useValue: mappingsStub },
        { provide: AuthService, useValue: authStub },
      ],
    });
    resolver = TestBed.inject(ImageResolverService);
  });

  afterEach(() => {
    adapter = null as never;
    resolver = null as never;
  });

  it('passes through http(s) URLs unchanged', async () => {
    const url = await resolver.resolve('https://example.com/a.jpg');
    expect(url).toBe('https://example.com/a.jpg');
  });

  it('passes through data: URLs unchanged', async () => {
    const url = await resolver.resolve('data:image/png;base64,abc');
    expect(url).toBe('data:image/png;base64,abc');
  });

  it('passes through blob: URLs unchanged', async () => {
    const url = await resolver.resolve('blob:http://localhost/abc');
    expect(url).toBe('blob:http://localhost/abc');
  });

  it('returns empty string for empty/null input', async () => {
    expect(await resolver.resolve('')).toBe('');
    expect(await resolver.resolve(null)).toBe('');
    expect(await resolver.resolve(undefined)).toBe('');
  });

  it('resolves idb:// references to blob: URLs', async () => {
    const file = new File([new Blob(['content'], { type: 'image/png' })], 'a.png', { type: 'image/png' });
    const stored = await adapter.save(file);
    const url = await resolver.resolve(`idb://${stored.id}`);
    expect(url).toMatch(/^blob:/);
  });

  it('caches resolved URLs (same id → same URL)', async () => {
    const file = new File([new Blob(['content'], { type: 'image/png' })], 'a.png', { type: 'image/png' });
    const stored = await adapter.save(file);
    const url1 = await resolver.resolve(`idb://${stored.id}`);
    const url2 = await resolver.resolve(`idb://${stored.id}`);
    expect(url1).toBe(url2);
  });

  it('getCached returns empty for unresolved idb:// references', () => {
    expect(resolver.getCached('idb://never-seen')).toBe('');
  });

  it('getCached returns the URL once resolved', async () => {
    const file = new File([new Blob(['content'], { type: 'image/png' })], 'a.png', { type: 'image/png' });
    const stored = await adapter.save(file);
    await resolver.resolve(`idb://${stored.id}`);
    expect(resolver.getCached(`idb://${stored.id}`)).toMatch(/^blob:/);
  });

  it('isStoredRef identifies idb:// references', () => {
    expect(resolver.isStoredRef('idb://abc')).toBe(true);
    expect(resolver.isStoredRef('https://example.com')).toBe(false);
    expect(resolver.isStoredRef('')).toBe(false);
  });

  it('preload resolves multiple URLs in parallel', async () => {
    const file1 = new File([new Blob(['a'], { type: 'image/png' })], 'a.png', { type: 'image/png' });
    const file2 = new File([new Blob(['b'], { type: 'image/png' })], 'b.png', { type: 'image/png' });
    const s1 = await adapter.save(file1);
    const s2 = await adapter.save(file2);

    await resolver.preload([`idb://${s1.id}`, `idb://${s2.id}`, 'https://example.com/c.jpg']);

    expect(resolver.getCached(`idb://${s1.id}`)).toMatch(/^blob:/);
    expect(resolver.getCached(`idb://${s2.id}`)).toMatch(/^blob:/);
  });
});
