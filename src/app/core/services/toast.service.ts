import { Injectable, inject, signal, computed } from '@angular/core';
import { I18nService } from './i18n.service';

/**
 * Toast notification service.
 *
 * Toasts are queued in a signal; the `<app-toaster>` component (mounted once
 * in `app.html`) renders the queue and auto-dismisses each toast after a
 * timeout. Other services call `toast.success('toast.saved')` etc. with an
 * i18n key — the resolved translation is shown.
 *
 * Dismissal is two-phase so the CSS exit animation can play before the
 * element is removed from the DOM:
 *   1. `dismiss(id)` marks the toast as `leaving: true` (CSS animates it
 *      sliding out + fading).
 *   2. After EXIT_ANIM_MS, the toast is actually removed from the queue.
 *
 * The auto-dismiss `setTimeout` calls `dismiss(id)`, which starts the exit
 * animation. The user dismiss button also calls `dismiss(id)`.
 */

export type ToastKind = 'success' | 'info' | 'warn' | 'error';

export interface ToastEntry {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
  /** Auto-dismiss after this many ms; 0 = sticky. */
  readonly ttl: number;
  /** True once the toast has started its exit animation. The CSS plays
   *  the slide-out + fade; after EXIT_ANIM_MS the entry is removed. */
  leaving: boolean;
}

const DEFAULT_TTL_MS = 3800;
const EXIT_ANIM_MS = 280;

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly i18n = inject(I18nService);

  private nextId = 1;
  private readonly _queue = signal<ToastEntry[]>([]);
  /** All toasts currently on screen (newest first). */
  readonly toasts = computed(() => this._queue());

  success(key: string, params?: Record<string, unknown>): void {
    this.push('success', this.resolve(key, params), DEFAULT_TTL_MS);
  }

  info(key: string, params?: Record<string, unknown>): void {
    this.push('info', this.resolve(key, params), DEFAULT_TTL_MS);
  }

  warn(key: string, params?: Record<string, unknown>): void {
    this.push('warn', this.resolve(key, params), 6000);
  }

  error(key: string, params?: Record<string, unknown>): void {
    this.push('error', this.resolve(key, params), 7000);
  }

  /** Show a raw string (not an i18n key) — used for error messages that
   *  already include dynamic content from third-party libraries. */
  raw(kind: ToastKind, message: string, ttl: number = DEFAULT_TTL_MS): void {
    this.push(kind, message, ttl);
  }

  /** Begin the exit animation for a toast. After EXIT_ANIM_MS the entry
   *  is removed from the queue entirely. */
  dismiss(id: number): void {
    // Phase 1: mark as leaving so the CSS exit animation plays.
    this._queue.update((q) =>
      q.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
    );
    // Phase 2: actually remove after the animation finishes.
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        this._queue.update((q) => q.filter((t) => t.id !== id));
      }, EXIT_ANIM_MS);
    }
  }

  private push(kind: ToastKind, message: string, ttl: number): void {
    const entry: ToastEntry = {
      id: this.nextId++,
      kind,
      message,
      ttl,
      leaving: false,
    };
    this._queue.update((q) => [entry, ...q].slice(0, 5));
    if (ttl > 0 && typeof window !== 'undefined') {
      window.setTimeout(() => this.dismiss(entry.id), ttl);
    }
  }

  private resolve(key: string, params?: Record<string, unknown>): string {
    // If the key doesn't translate (returns the key back), show it raw —
    // lets callers pass either an i18n key or a literal string.
    const out = this.i18n.t(key, params);
    return out === key && !key.includes('.') ? key : out;
  }
}
