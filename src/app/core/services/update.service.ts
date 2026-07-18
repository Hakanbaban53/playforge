import { Injectable, signal } from '@angular/core';

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  releaseNotes?: string;
  releaseUrl?: string;
}

export interface DownloadProgress {
  downloaded: number;
  total: number;
  percentage: number;
}

/**
 * App update service — only active in Tauri mode.
 *
 * Uses Tauri's `updater` plugin (via `@tauri-apps/plugin-updater`) to:
 *   1. Check GitHub releases for a newer version
 *   2. Download the update with progress tracking
 *   3. Install and restart the app
 *
 * In web mode, all methods are no-ops — the update UI is hidden.
 *
 * Setup for GitHub releases:
 *   1. Generate a signing key pair:
 *      `npx @tauri-apps/cli signer generate -w ~/.tauri/playforge.key`
 *   2. Set env vars in CI:
 *      TAURI_SIGNING_PRIVATE_KEY=@path/to/key
 *      TAURI_SIGNING_PRIVATE_KEY_PASSWORD=your_password
 *   3. Update `tauri.conf.json` → `plugins.updater.endpoints` with your
 *      GitHub repo URL.
 *   4. Update `plugins.updater.pubkey` with the public key.
 *   5. `npm run tauri:build` produces `latest.json` + signed installers
 *      in `src-tauri/target/release/bundle/`.
 *   6. Create a GitHub release and upload the artifacts.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  readonly updateAvailable = signal<UpdateInfo | null>(null);
  readonly downloading = signal(false);
  readonly progress = signal<DownloadProgress | null>(null);
  readonly error = signal<string | null>(null);
  readonly checking = signal(false);

  constructor() {
    void this.setupListener();
    void this.checkForUpdates();
  }

  /** True if running inside Desktop Tauri (auto-updates only work on Desktop). */
  static isDesktopTauri(): boolean {
    if (typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === 'undefined') {
      return false;
    }
    // Mobile platforms (Android / iOS) do not support desktop auto-updater
    const isMobile = typeof (window as unknown as { AndroidAuth?: unknown }).AndroidAuth !== 'undefined' ||
                     /android|iphone|ipad|ipod/i.test(navigator.userAgent);
    return !isMobile;
  }

  /** Alias for isDesktopTauri for backwards compatibility. */
  static isTauri(): boolean {
    return this.isDesktopTauri();
  }

  /** Check if an update is available. No-op in web and mobile mode. */
  async checkForUpdates(): Promise<void> {
    if (!UpdateService.isDesktopTauri()) return;

    this.checking.set(true);
    this.error.set(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<UpdateInfo | null>('check_for_updates');
      this.updateAvailable.set(result);
    } catch (err) {
      console.warn('[Update] Check failed:', err);
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.checking.set(false);
    }
  }

  private async setupListener(): Promise<void> {
    if (!UpdateService.isDesktopTauri()) return;

    try {
      const { listen } = await import('@tauri-apps/api/event');
      await listen<UpdateInfo>('update-available', (event) => {
        console.info('[Update] Update event received from backend:', event.payload);
        this.updateAvailable.set(event.payload);
      });
    } catch (err) {
      console.warn('[Update] Failed to setup listener:', err);
    }
  }

  /** Download and install the update, then restart. No-op in web and mobile mode. */
  async downloadAndInstall(): Promise<void> {
    if (!UpdateService.isDesktopTauri()) return;

    this.downloading.set(true);
    this.error.set(null);
    this.progress.set({ downloaded: 0, total: 0, percentage: 0 });

    try {
      // Listen for progress events.
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<DownloadProgress>('update-progress', (event) => {
        this.progress.set(event.payload);
      });

      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('download_and_install_update');

      unlisten();
      // App will restart after install — this code may not execute.
    } catch (err) {
      console.error('[Update] Download/install failed:', err);
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.downloading.set(false);
    }
  }

  /** Dismiss the current update notification. */
  dismiss(): void {
    this.updateAvailable.set(null);
    this.error.set(null);
    this.progress.set(null);
  }
}
