/**
 * File storage abstraction.
 *
 * The app persists user-uploaded images through this adapter. The interface
 * is intentionally minimal so that:
 *
 *   - In **web mode** (current), `BrowserFileStorageAdapter` stores blobs in
 *     IndexedDB and resolves them to `blob:` URLs. No server, no cloud.
 *
 *   - In **Tauri mode** (future), `TauriFileStorageAdapter` will write files
 *     to disk via `@tauri-apps/plugin-fs` and resolve them via
 *     `convertFileSrc()` (`asset://localhost/...`). The adapter signature
 *     stays identical; only the DI provider in `main.ts` changes.
 *
 * Why not just use `URL.createObjectURL(file)` directly?
 *   - Blob URLs are revoked on page reload, so uploaded images would
 *     disappear after a refresh. IndexedDB persists across reloads, and the
 *     adapter re-creates blob URLs on demand from the stored bytes.
 *
 * Why not store as data URIs in localStorage?
 *   - localStorage has a ~5 MB limit; a single photo can exceed that.
 *     IndexedDB has gigabytes of quota.
 */

/** Metadata for a persisted file. Survives reloads. */
export interface StoredFile {
  /** Stable, opaque id (e.g. `idb-1700000000-abc123`). */
  id: string;
  /** Original filename (for display + extension inference). */
  name: string;
  /** MIME type (e.g. `image/png`). */
  mimeType: string;
  /** File size in bytes. */
  size: number;
}

/**
 * Platform-agnostic file storage. Implementations:
 *   - `BrowserFileStorageAdapter` (web) — IndexedDB + blob URLs
 *   - `TauriFileStorageAdapter` (future) — Tauri `fs` plugin + `asset://` URLs
 */
export abstract class FileStorageAdapter {
  /** Persist a file. Returns metadata that survives reloads. */
  abstract save(file: File): Promise<StoredFile>;

  /**
   * Resolve a stored file to a URL the browser can use in `<img src>`,
   * canvas drawImage, etc. The URL is platform-specific:
   *   - Web: `blob:` URL (valid for the lifetime of the page)
   *   - Tauri: `asset://` URL (valid forever)
   *
   * The implementation may cache the URL so repeated calls return the same
   * instance.
   */
  abstract resolveUrl(stored: StoredFile): Promise<string>;

  /**
   * Read the raw bytes of a stored file. Used by the PDF service to embed
   * images directly into the PDF without going through `<img>` first.
   */
  abstract readBytes(stored: StoredFile): Promise<ArrayBuffer | null>;

  /** Delete a stored file. */
  abstract delete(stored: StoredFile): Promise<void>;
}

/**
 * Parse a `StoredFile`-compatible URL reference back into a `StoredFile`.
 *
 * URLs produced by `resolveUrl` are platform-specific and not directly
 * reversible — instead, callers that need to round-trip should store the
 * `StoredFile` object alongside its usage. This helper is for the rare case
 * where a URL string is the only thing available (e.g. in catalog image
 * fields). We encode the StoredFile id into the URL so it can be extracted.
 *
 * The web adapter uses URLs of the form `blob:http://localhost:4200/<uuid>`,
 * which are not reversible. To support round-tripping, the upload service
 * stores images in the catalog as `idb://<id>` pseudo-URLs and resolves them
 * to real blob: URLs at render time. This helper parses those pseudo-URLs.
 */
export function parseStoredFileRef(url: string): { kind: 'idb'; id: string } | null {
  const m = /^idb:\/\/(.+)$/.exec(url);
  return m ? { kind: 'idb', id: m[1] } : null;
}
