import { Injectable, effect, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Theme service — light / dark / system preference.
 *
 * Persists the choice in localStorage and applies it by toggling the
 * `data-theme` attribute on the root `<html>` element. The SCSS design
 * system reads this attribute to swap CSS custom-property values.
 *
 * `system` mode listens to `prefers-color-scheme` media query and follows
 * the OS preference.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly storageKey = 'pgpos:theme';
  private readonly _mode = signal<ThemeMode>(this.readStored());
  private mediaQuery?: MediaQueryList;

  readonly mode = this._mode.asReadonly();
  /** Resolved theme — what's actually applied right now. */
  readonly resolved = signal<'light' | 'dark'>('light');

  constructor() {
    // React to mode changes.
    effect(() => {
      const m = this._mode();
      this.persist(m);
      this.apply(m);
    });

    // Listen to OS preference changes when in `system` mode.
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.mediaQuery.addEventListener('change', () => {
        if (this._mode() === 'system') this.apply('system');
      });
    }
  }

  /** Called once at app bootstrap to avoid flash of wrong theme. */
  applyInitial(): void {
    this.apply(this._mode());
  }

  setMode(mode: ThemeMode): void {
    this._mode.set(mode);
    // Apply synchronously so callers (and tests) see the change immediately.
    // The constructor's effect() also applies, but only on the next microtask.
    this.persist(mode);
    this.apply(mode);
  }

  toggle(): void {
    const next: ThemeMode = this.resolved() === 'dark' ? 'light' : 'dark';
    this.setMode(next);
  }

  private apply(mode: ThemeMode): void {
    const resolved: 'light' | 'dark' =
      mode === 'system'
        ? this.mediaQuery?.matches
          ? 'dark'
          : 'light'
        : mode;
    this.resolved.set(resolved);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', resolved);
    }
  }

  private readStored(): ThemeMode {
    if (typeof localStorage === 'undefined') return 'system';
    const v = localStorage.getItem(this.storageKey);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  }

  private persist(mode: ThemeMode): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(this.storageKey, mode);
  }
}
