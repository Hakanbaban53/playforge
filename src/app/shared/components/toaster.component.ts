import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ToastService, ToastKind } from '../../core/services/toast.service';
import { IconComponent } from './icon.component';

/**
 * Toast renderer — mounted once in `app.html`. Reads the toast queue from
 * `ToastService` and renders each entry with an icon, message, dismiss
 * button, and a depleting progress bar at the bottom.
 *
 * The icon carries the type color; the card itself stays neutral.
 * Entry: slide-in from the right + fade.
 * Exit: slide-out to the right + fade (two-phase via `ToastService.dismiss()`).
 */
@Component({
  selector: 'app-toaster',
  standalone: true,
  imports: [IconComponent, TranslatePipe],
  template: `
    <div class="toaster" role="region" aria-live="polite" aria-label="Notifications">
      @for (t of toast.toasts(); track t.id) {
        <div
          class="toast"
          [class]="'toast--' + t.kind"
          [class.toast--leaving]="t.leaving"
          [style.--toast-ttl]="t.ttl + 'ms'"
          role="status"
        >
          <app-icon class="toast__icon" [name]="iconFor(t.kind)" [size]="18" />
          <span class="toast__msg">{{ t.message }}</span>
          <button
            type="button"
            class="toast__dismiss"
            (click)="toast.dismiss(t.id)"
            [attr.aria-label]="'common.close' | translate"
          >
            <app-icon name="close" [size]="14" />
          </button>
          @if (t.ttl > 0) {
            <span class="toast__progress" aria-hidden="true"></span>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 9000;
      pointer-events: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: calc(100vw - 32px);
      width: 380px;
    }

    .toaster {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .toast {
      pointer-events: auto;
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      /* Extra bottom padding so the progress bar doesn't overlap the text. */
      padding-bottom: 14px;
      border-radius: var(--radius-md);
      background: var(--surface-0);
      box-shadow: 0 0 0 1px var(--surface-200);
      font-size: 13px;
      color: var(--text-base);
      animation: toast-enter 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

      &--leaving {
        animation: toast-exit 280ms cubic-bezier(0.4, 0, 0.6, 1) both;
      }

      &__icon {
        flex-shrink: 0;
      }

      &__msg {
        flex: 1;
        line-height: 1.4;
        min-width: 0;
      }

      &__dismiss {
        border: none;
        background: transparent;
        color: var(--text-subtle);
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        display: grid;
        place-items: center;
        flex-shrink: 0;

        &:hover {
          color: var(--text-base);
          background: var(--surface-100);
        }
      }

      /* Progress bar — a thin bar pinned to the bottom of the toast that
         shrinks from 100% to 0% over the toast's TTL. The TTL is set as
         a CSS custom property (--toast-ttl) via inline style on the toast
         element, so the animation duration always matches. */
      &__progress {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 3px;
        background: var(--surface-200);
        transform-origin: left;
        animation: toast-deplete var(--toast-ttl, 3800ms) linear forwards;
      }

      /* Type colors — applied only to the icon, not to any border.
         The card itself stays neutral (surface-0) so it doesn't fight
         the app's design system. */
      &--success .toast__icon { color: var(--success-500); }
      &--success .toast__progress { background: var(--success-500); }

      &--info .toast__icon { color: var(--info-500); }
      &--info .toast__progress { background: var(--info-500); }

      &--warn .toast__icon { color: var(--warn-500); }
      &--warn .toast__progress { background: var(--warn-500); }

      &--error .toast__icon { color: var(--danger-500); }
      &--error .toast__progress { background: var(--danger-500); }

      /* When leaving, stop the progress bar animation so it doesn't
         jump around during the exit fade. */
      &--leaving .toast__progress {
        animation-play-state: paused;
      }
    }

    @keyframes toast-enter {
      from {
        opacity: 0;
        transform: translateX(24px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateX(0) scale(1);
      }
    }

    @keyframes toast-exit {
      from {
        opacity: 1;
        transform: translateX(0) scale(1);
      }
      to {
        opacity: 0;
        transform: translateX(24px) scale(0.98);
      }
    }

    @keyframes toast-deplete {
      from { transform: scaleX(1); }
      to   { transform: scaleX(0); }
    }

    @media (max-width: 480px) {
      :host {
        top: 8px;
        right: 8px;
        left: 8px;
        width: auto;
      }
    }
  `],
})
export class ToasterComponent {
  readonly toast = inject(ToastService);

  iconFor(kind: ToastKind): string {
    switch (kind) {
      case 'success': return 'check_circle';
      case 'info':    return 'info';
      case 'warn':    return 'warning';
      case 'error':   return 'error';
      default:        return 'info';
    }
  }
}
