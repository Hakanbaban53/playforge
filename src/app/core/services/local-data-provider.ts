import { Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { DataProvider, SyncState } from './data-provider';

/**
 * Local-only data provider — backed by localStorage.
 *
 * This is the default when the user is not signed in. All reads/writes
 * go through localStorage with the `pgpos:` prefix. No cloud, no sync.
 *
 * State management:
 *   - Each collection is stored as a single JSON array under one key.
 *   - An in-memory signal mirrors the persisted array so consumers get
 *     reactivity without re-reading localStorage on every read.
 *   - Writes update both the signal and localStorage atomically.
 *
 * Single-doc API (`doc()` / `setDoc()`):
 *   - Stored as a single JSON value under its key.
 *   - Backed by a signal of `(T | null)` per doc name.
 *
 * No persistence cache to clear on `dispose()` — the data stays in
 * localStorage so the user can come back later. `dispose()` just
 * detaches the in-memory signals.
 */
@Injectable({ providedIn: 'root' })
export class LocalDataProvider extends DataProvider {
  private readonly prefix = 'pgpos:';

  /** In-memory signal map: collection name → signal of T[]. */
  private readonly collectionSignals = new Map<string, WritableSignal<unknown[]>>();
  /** In-memory signal map: doc name → signal of (T | null). */
  private readonly docSignals = new Map<string, WritableSignal<unknown>>();

  private readonly _syncState = signal<SyncState>('local');
  private readonly _lastSyncedAt = signal<number | null>(null);

  readonly syncState: Signal<SyncState> = this._syncState.asReadonly();
  readonly lastSyncedAt = this._lastSyncedAt.asReadonly();

  collection<T>(name: string): Signal<T[]> {
    return this.getOrCreateCollectionSignal<T>(name).asReadonly();
  }

  doc<T>(name: string): Signal<T | null> {
    return this.getOrCreateDocSignal<T>(name).asReadonly();
  }

  setRecord<T extends { id: string }>(name: string, value: T): Promise<void> {
    const sig = this.getOrCreateCollectionSignal<T>(name);
    const current = sig();
    const idx = current.findIndex((r) => r.id === value.id);
    const next = idx >= 0
      ? current.map((r) => (r.id === value.id ? value : r))
      : [...current, value];
    sig.set(next);
    this.persistCollection(name, next);
    return Promise.resolve();
  }

  removeRecord(name: string, id: string): Promise<void> {
    const sig = this.getOrCreateCollectionSignal<{ id: string }>(name);
    const next = sig().filter((r) => r.id !== id);
    sig.set(next);
    this.persistCollection(name, next);
    return Promise.resolve();
  }

  replaceCollection<T extends { id: string }>(name: string, values: T[]): Promise<void> {
    const sig = this.getOrCreateCollectionSignal<T>(name);
    sig.set([...values]);
    this.persistCollection(name, values);
    return Promise.resolve();
  }

  setDoc<T>(name: string, value: T): Promise<void> {
    const sig = this.getOrCreateDocSignal<T>(name);
    sig.set(value);
    this.persistDoc(name, value);
    return Promise.resolve();
  }

  removeDoc(name: string): Promise<void> {
    const sig = this.getOrCreateDocSignal<unknown>(name);
    sig.set(null);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.prefix + name);
    }
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    // Local mode: keep data in localStorage so the user can return.
    // IMPORTANT: We deliberately do NOT clear the in-memory signal map.
    // The FirstLoginMergeService reads from this provider's signals AFTER
    // the active backend has swapped to Firestore — clearing them here
    // would make the merge see empty data and silently drop the user's
    // local work.
    //
    // The signals are harmless to keep around — they just hold a
    // reference to the last-read array. Memory impact is negligible.
    // If we ever need to truly reset (e.g. wipeAll in dev tools), the
    // signal values are re-read from localStorage on next access.
    return Promise.resolve();
  }

  // ---- internals ----

  private getOrCreateCollectionSignal<T>(name: string): WritableSignal<T[]> {
    let sig = this.collectionSignals.get(name) as WritableSignal<T[]> | undefined;
    if (!sig) {
      const initial = this.readCollection<T>(name);
      sig = signal<T[]>(initial);
      this.collectionSignals.set(name, sig);
    }
    return sig;
  }

  private getOrCreateDocSignal<T>(name: string): WritableSignal<T | null> {
    let sig = this.docSignals.get(name) as WritableSignal<T | null> | undefined;
    if (!sig) {
      const initial = this.readDoc<T>(name);
      sig = signal<T | null>(initial);
      this.docSignals.set(name, sig);
    }
    return sig;
  }

  private readCollection<T>(name: string): T[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(this.prefix + name);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch (err) {
      console.warn(`[LocalDataProvider] Failed to read collection ${name}:`, err);
      return [];
    }
  }

  private readDoc<T>(name: string): T | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(this.prefix + name);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      console.warn(`[LocalDataProvider] Failed to read doc ${name}:`, err);
      return null;
    }
  }

  private persistCollection(name: string, values: unknown[]): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.prefix + name, JSON.stringify(values));
    } catch (err) {
      console.error(`[LocalDataProvider] Failed to persist collection ${name}:`, err);
    }
  }

  private persistDoc(name: string, value: unknown): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.prefix + name, JSON.stringify(value));
    } catch (err) {
      console.error(`[LocalDataProvider] Failed to persist doc ${name}:`, err);
    }
  }
}
