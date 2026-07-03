import { Injectable } from '@angular/core';

/**
 * Persistence abstraction.
 *
 * The current implementation uses `localStorage` so the app is fully
 * functional as a standalone SPA. The interface is intentionally minimal
 * so a real backend (REST/GraphQL) can replace it without touching feature
 * code — only this file changes.
 */
@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly prefix = 'pgpos:';

  read<T>(key: string, fallback: T): T {
    if (typeof localStorage === 'undefined') return fallback;
    try {
      const raw = localStorage.getItem(this.prefix + key);
      if (raw == null) return fallback;
      return JSON.parse(raw) as T;
    } catch (err) {
      console.warn(`[Storage] Failed to read ${key}:`, err);
      return fallback;
    }
  }

  write<T>(key: string, value: T): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch (err) {
      console.error(`[Storage] Failed to write ${key}:`, err);
    }
  }

  remove(key: string): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(this.prefix + key);
  }

  exists(key: string): boolean {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(this.prefix + key) != null;
  }
}
