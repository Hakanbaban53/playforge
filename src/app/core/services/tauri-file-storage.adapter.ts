import { FileStorageAdapter, StoredFile } from './file-storage.adapter';

/**
 * Tauri-mode file storage — writes files to disk via Tauri's `fs` plugin
 * and resolves them to `asset://` URLs via `convertFileSrc()`.
 *
 * This replaces `BrowserFileStorageAdapter` (IndexedDB) when the app runs
 * inside Tauri. The switch happens in `app.config.ts` based on platform
 * detection (`isTauri()`).
 *
 * Storage layout on disk:
 *   $APPDATA/images/<id>.<ext>
 *
 * Where `$APPDATA` is Tauri's per-user app data directory (e.g.
 * `~/.local/share/com.playforge.app` on Linux,
 * `~/Library/Application Support/com.playforge.app` on macOS,
 * `%APPDATA%/com.playforge.app` on Windows).
 *
 * URL resolution: `convertFileSrc(path)` converts a filesystem path to an
 * `asset://localhost/...` URL that the Tauri webview can render in `<img>`.
 * These URLs are stable across reloads (unlike blob: URLs) and work in
 * html2canvas (used by the PDF service).
 */
export class TauriFileStorageAdapter extends FileStorageAdapter {
  private imagesDir: string | null = null;

  /** True if running inside Tauri (vs. plain browser). */
  static async isTauri(): Promise<boolean> {
    try {
      await import('@tauri-apps/api/core');
      // Check if `window.__TAURI_INTERNALS__` exists — it's only present
      // when running inside a Tauri webview.
      return typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';
    } catch {
      return false;
    }
  }

  /** Lazily import Tauri APIs (only available inside Tauri). */
  private async getFs() {
    const mod = await import('@tauri-apps/plugin-fs');
    return mod;
  }

  private async getCore() {
    const mod = await import('@tauri-apps/api/core');
    return mod;
  }

  private async getPath() {
    const mod = await import('@tauri-apps/api/path');
    return mod;
  }

  /** Get (or create) the images directory under $APPDATA. */
  private async getImagesDir(): Promise<string> {
    if (this.imagesDir) return this.imagesDir;
    const path = await this.getPath();
    const appData = await path.appDataDir();
    this.imagesDir = await path.join(appData, 'images');
    const fs = await this.getFs();
    try {
      await fs.exists(this.imagesDir);
    } catch {
      await fs.mkdir(this.imagesDir, { recursive: true });
    }
    // Ensure the directory exists.
    try {
      await fs.mkdir(this.imagesDir, { recursive: true });
    } catch {
      // already exists — fine
    }
    return this.imagesDir;
  }

  /** Extract file extension from filename, defaulting to `.bin`. */
  private ext(name: string): string {
    if (!name) return '.bin';
    const m = name.match(/\.[a-z0-9]+$/i);
    return m ? m[0] : '.bin';
  }

  /** Resolve the on-disk path for a stored file, even after reload. */
  private async resolveFilePath(stored: StoredFile): Promise<string | null> {
    const fs = await this.getFs();
    const dir = await this.getImagesDir();
    const ext = this.ext(stored.name);
    const expectedPath = `${dir}/${stored.id}${ext}`;

    if (await fs.exists(expectedPath)) {
      return expectedPath;
    }

    const entries = await fs.readDir(dir);
    const match = entries.find((entry) => entry.isFile && (entry.name === stored.id || entry.name.startsWith(`${stored.id}.`)));
    if (!match) return null;

    return `${dir}/${match.name}`;
  }

  async save(file: File): Promise<StoredFile> {
    const fs = await this.getFs();
    const dir = await this.getImagesDir();

    const id = `tauri-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ext = this.ext(file.name);
    const filename = `${id}${ext}`;
    const filepath = `${dir}/${filename}`;

    // Read file bytes and write to disk.
    const bytes = new Uint8Array(await file.arrayBuffer());
    await fs.writeFile(filepath, bytes);

    return {
      id,
      name: file.name,
      mimeType: file.type,
      size: file.size,
    };
  }

  async resolveUrl(stored: StoredFile): Promise<string> {
    const core = await this.getCore();
    const filepath = await this.resolveFilePath(stored);
    if (!filepath) {
      throw new Error(`File not found in storage: ${stored.id}`);
    }

    // convertFileSrc() turns a filesystem path into an `asset://localhost/...`
    // URL that the Tauri webview can render in `<img>` tags.
    return core.convertFileSrc(filepath);
  }

  async readBytes(stored: StoredFile): Promise<ArrayBuffer | null> {
    const fs = await this.getFs();
    const filepath = await this.resolveFilePath(stored);
    if (!filepath) return null;

    try {
      const bytes = await fs.readFile(filepath);
      return bytes.buffer as ArrayBuffer;
    } catch {
      return null;
    }
  }

  async delete(stored: StoredFile): Promise<void> {
    const fs = await this.getFs();
    const filepath = await this.resolveFilePath(stored);
    if (!filepath) return;

    try {
      await fs.remove(filepath);
    } catch {
      // file may not exist — fine
    }
  }
}
