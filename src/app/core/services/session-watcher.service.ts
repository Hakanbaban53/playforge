import { Injectable, inject, effect } from '@angular/core';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';

/**
 * Surfaces session-end events to the user via toasts.
 *
 *   - `expired` (token revoked / refresh failed mid-session) →
 *     "Your session expired. Please sign in again." (warn toast)
 *   - `cross-tab` (another tab signed out) →
 *     "You signed out in another tab." (info toast)
 *   - `explicit` (this tab's user clicked "Sign out") → silent
 *     (the user already knows — they clicked the button).
 *   - `initial` (first hydration, no user) → silent.
 *
 * Mounted once via `provideAppInitializer` in `app.config.ts` so the
 * effect is alive for the entire app lifetime.
 */
@Injectable({ providedIn: 'root' })
export class SessionWatcher {
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  constructor() {
    effect(() => {
      const epoch = this.auth.logoutEpoch();
      const reason = this.auth.lastSessionEndReason();
      // Skip the initial 0 epoch (no session has ended yet).
      if (epoch === 0) return;

      if (reason === 'expired') {
        this.toast.warn('auth.sessionExpired');
      } else if (reason === 'cross-tab') {
        this.toast.info('auth.sessionEndedElsewhere');
      }
      // 'explicit' and 'initial' are silent.
    });
  }
}
