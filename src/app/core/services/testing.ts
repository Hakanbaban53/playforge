import { Provider, Signal, signal } from '@angular/core';
import { DataProvider, SyncState } from './data-provider';
import { AuthService, AppUser } from './auth.service';
import { FileStorageAdapter, StoredFile } from './file-storage.adapter';
import { LocalDataProvider } from './local-data-provider';

/**
 * Shared test doubles for service specs.
 *
 * Several services (CatalogService, InvoiceService, ConfiguratorService,
 * ImageResolverService, etc.) depend on `DataProvider`, `AuthService`,
 * and `FileStorageAdapter`. Tests that exercise those services need to
 * provide stubs — these helpers keep the boilerplate in one place.
 */

/** Minimal in-memory DataProvider for tests. Backed by a Map per
 *  collection name; emits via signals so computed() chains work. */
export class InMemoryDataProvider extends DataProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test utility: collections hold heterogeneous record shapes.
  private readonly collectionSignals = new Map<string, ReturnType<typeof signal<any[]>>>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above.
  private readonly docSignals = new Map<string, ReturnType<typeof signal<any>>>();

  readonly syncState = signal<SyncState>('local');
  readonly lastSyncedAt = signal<number | null>(null);

  collection<T>(name: string): Signal<T[]> {
    if (!this.collectionSignals.has(name)) {
      this.collectionSignals.set(name, signal<T[]>([]));
    }
    return this.collectionSignals.get(name)! as Signal<T[]>;
  }

  doc<T>(name: string): Signal<T | null> {
    if (!this.docSignals.has(name)) {
      this.docSignals.set(name, signal<T | null>(null));
    }
    return this.docSignals.get(name)! as Signal<T | null>;
  }

  async setRecord<T extends { id: string }>(name: string, value: T): Promise<void> {
    const sig = this.collectionSignals.get(name) ?? signal<T[]>([]);
    if (!this.collectionSignals.has(name)) this.collectionSignals.set(name, sig);
    const current = sig() as T[];
    const next = current.some((r) => r.id === value.id)
      ? current.map((r) => (r.id === value.id ? value : r))
      : [...current, value];
    sig.set(next);
  }

  async removeRecord(name: string, id: string): Promise<void> {
    const sig = this.collectionSignals.get(name);
    if (!sig) return;
    sig.set((sig() as { id: string }[]).filter((r) => r.id !== id));
  }

  async replaceCollection<T extends { id: string }>(name: string, values: T[]): Promise<void> {
    let sig = this.collectionSignals.get(name);
    if (!sig) {
      sig = signal<T[]>([]);
      this.collectionSignals.set(name, sig);
    }
    sig.set(values);
  }

  async setDoc<T>(name: string, value: T): Promise<void> {
    let sig = this.docSignals.get(name);
    if (!sig) {
      sig = signal<T | null>(null);
      this.docSignals.set(name, sig);
    }
    sig.set(value);
  }

  async removeDoc(name: string): Promise<void> {
    const sig = this.docSignals.get(name);
    if (sig) sig.set(null);
  }

  async dispose(): Promise<void> {
    this.collectionSignals.clear();
    this.docSignals.clear();
  }
}

/**
 * Stub AuthService for tests that don't actually exercise auth flows.
 * Default state is "logged out" (no user). Call `setUser()` to
 * simulate a signed-in user, or `bumpLogoutEpoch()` to fire the
 * logout-reset effect.
 */
export class StubAuthService {
  private readonly _user = signal<AppUser | null>(null);
  private readonly _logoutEpoch = signal(0);
  private _lastSessionEndReason: 'explicit' | 'expired' | 'cross-tab' | 'initial' | null = null;

  readonly user = this._user.asReadonly();
  readonly isAuthenticated = () => this._user() !== null;
  readonly cloudEnabled = true;
  readonly signingIn = signal(false).asReadonly();
  readonly hydrated = signal(true).asReadonly();
  readonly justSignedIn = signal(false).asReadonly();
  readonly logoutEpoch = this._logoutEpoch.asReadonly();
  readonly lastSessionEndReason = signal(this._lastSessionEndReason).asReadonly();

  setUser(user: AppUser | null): void {
    this._user.set(user);
  }

  bumpLogoutEpoch(reason: 'explicit' | 'expired' | 'cross-tab' = 'explicit'): void {
    this._lastSessionEndReason = reason;
    this._logoutEpoch.update((v) => v + 1);
  }
}

/** Stub FileStorageAdapter for tests that don't actually touch IndexedDB.
 *  Saves files in-memory and returns synthetic blob: URLs. */
export class InMemoryFileStorageAdapter implements FileStorageAdapter {
  private readonly files = new Map<string, { name: string; mimeType: string; size: number; bytes: ArrayBuffer }>();
  private nextId = 1;

  async save(file: File): Promise<StoredFile> {
    const id = `idb-test-${this.nextId++}`;
    const bytes = await file.arrayBuffer();
    this.files.set(id, { name: file.name, mimeType: file.type, size: file.size, bytes });
    return { id, name: file.name, mimeType: file.type, size: file.size };
  }

  async saveWithId(id: string, bytes: ArrayBuffer, mimeType: string, filename: string): Promise<StoredFile> {
    this.files.set(id, { name: filename, mimeType, size: bytes.byteLength, bytes });
    return { id, name: filename, mimeType, size: bytes.byteLength };
  }

  resolveUrl(stored: StoredFile): Promise<string> {
    return Promise.resolve(`blob:test/${stored.id}`);
  }

  async readBytes(stored: StoredFile): Promise<ArrayBuffer | null> {
    return this.files.get(stored.id)?.bytes ?? null;
  }

  async delete(stored: StoredFile): Promise<void> {
    this.files.delete(stored.id);
  }

  async clearAll(): Promise<void> {
    this.files.clear();
  }
}

/** Provider override that swaps `DataProvider` for `InMemoryDataProvider`,
 *  `AuthService` for `StubAuthService`, `FileStorageAdapter` for
 *  `InMemoryFileStorageAdapter`, and `LocalDataProvider` for
 *  `InMemoryDataProvider`. Use in TestBed.configureTestingModule. */
export function provideInMemoryDataAndStubAuth(): Provider[] {
  return [
    { provide: DataProvider, useClass: InMemoryDataProvider },
    { provide: LocalDataProvider, useClass: InMemoryDataProvider },
    { provide: AuthService, useClass: StubAuthService },
    { provide: FileStorageAdapter, useClass: InMemoryFileStorageAdapter },
  ];
}

