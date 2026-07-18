import { Signal } from '@angular/core';

/**
 * Sync status — surfaced to the UI via `DataProvider.syncState`.
 *
 *   - `local`      — anonymous mode, no cloud. Always "saved" locally.
 *   - `synced`     — cloud mode, all writes confirmed by the server.
 *   - `syncing`    — cloud mode, writes pending.
 *   - `offline`    — cloud mode, network unreachable, writes queued
 *                    locally and will sync when reconnected.
 */
export type SyncState = 'local' | 'synced' | 'syncing' | 'offline';

/**
 * Reactive data access abstraction.
 *
 * The app has two storage backends:
 *   - `LocalDataProvider`  — localStorage + IndexedDB. Default when the
 *     user is not signed in. No cloud, no sync.
 *   - `FirestoreDataProvider` — Firestore with offline persistence.
 *     Active when the user is signed in. Real-time sync across devices.
 *
 * Both implement this interface, so feature services (`CustomersService`,
 * `InvoiceService`, etc.) don't care which backend is active. The DI
 * container swaps the provider when the user signs in or out.
 *
 * The shape is intentionally collection-oriented: each "collection"
 * corresponds to one of the user's data types (customers, invoices,
 * catalog families, etc.). The provider exposes:
 *
 *   - `collection<T>(name)` → a signal that emits the current array of T
 *   - `set<T>(name, id, value)` → upsert a single record
 *   - `remove(name, id)` → delete a single record
 *   - `replace<T>(name, values)` → bulk replace (used by imports / wipe)
 *
 * Plus a single-doc API for things like `receipt-layout` and `app-settings`
 * that are conceptually one document per user, not a collection.
 *
 * The provider is responsible for persisting to whatever backend it
 * represents. Feature services don't call `localStorage` directly.
 */
export abstract class DataProvider {
  /** Reactive sync state — used by the sync indicator in the UI. */
  abstract readonly syncState: Signal<SyncState>;

  /** Human-readable timestamp of the last successful server sync, or
   *  `null` if never synced (e.g. local mode or first launch). */
  abstract readonly lastSyncedAt: Signal<number | null>;

  /**
   * Get a reactive view of a collection. The returned signal emits the
   * current array of records and re-emits whenever the underlying data
   * changes (locally or via cloud sync).
   *
   * The signal is owned by the provider — callers should NOT call
   * `set()` on it. Use `setRecord()` / `removeRecord()` to mutate.
   */
  abstract collection<T>(name: string): Signal<T[]>;

  /**
   * Get a reactive view of a single document. Returns `null` until the
   * document exists. Used for settings, receipt layout, etc.
   */
  abstract doc<T>(name: string): Signal<T | null>;

  /** Upsert a single record in a collection. If `id` is already present,
   *  the existing record is replaced; otherwise it's appended. */
  abstract setRecord<T extends { id: string }>(name: string, value: T): Promise<void>;

  /** Remove a single record by id. No-op if the id doesn't exist. */
  abstract removeRecord(name: string, id: string): Promise<void>;

  /** Replace the entire contents of a collection. Used by imports and
   *  the dev-tools wipe action. */
  abstract replaceCollection<T extends { id: string }>(name: string, values: T[]): Promise<void>;

  /** Upsert a single document (no id — there's only one per name). */
  abstract setDoc<T>(name: string, value: T): Promise<void>;

  /** Remove a single document. */
  abstract removeDoc(name: string): Promise<void>;

  /**
   * Tear down all listeners and (for cloud mode) clear the local cache.
   * Called by `AuthService` on sign-out so the next user starts fresh.
   *
   * After `dispose()`, the provider is no longer usable — a new instance
   * must be created (the DI container handles this).
   */
  abstract dispose(): Promise<void>;
}

/**
 * Standard collection names — single source of truth so refactors don't
 * misspell them. Add new collections here as the app grows.
 */
export const Collections = {
  customers: 'customers',
  catalogFamilies: 'catalog:families',
  catalogVariants: 'catalog:variants',
  invoiceActive: 'invoice:active',
  invoiceSaved: 'invoice:saved',
  favorites: 'catalog:favorites',
  /** Single-doc "collections" — use `doc()` / `setDoc()` for these. */
  receiptLayout: 'receipt:layout',
  invoiceDefaults: 'app:invoice-defaults',
  currencyRates: 'app:exchange-rates',
  baseCurrency: 'app:base-currency',
  appLanguage: 'app:language',
} as const;

export type CollectionName = (typeof Collections)[keyof typeof Collections];
