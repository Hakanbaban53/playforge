import { Component, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../core/services/auth.service';
import { IconComponent } from './icon.component';

/**
 * Compact auth widget for the sidebar footer.
 *
 * Three states:
 *   1. Cloud disabled (`environment.firebase.enabled = false`):
 *      Hidden entirely. No cloud features, no UI clutter.
 *   2. Not signed in:
 *      Shows a "Sign in" pill button. Clicking triggers Google OAuth.
 *   3. Signed in:
 *      Shows the user's avatar (or initials fallback) + name. Clicking
 *      opens a small menu with a "Sign out" action.
 */
@Component({
  selector: 'app-auth-widget',
  standalone: true,
  imports: [TranslatePipe, IconComponent],
  template: `
    @if (cloudEnabled) {
      @if (user(); as u) {
        <button
          type="button"
          class="auth-widget auth-widget--signed-in"
          (click)="toggleMenu()"
          [attr.aria-label]="'auth.account' | translate"
        >
          <span class="auth-widget__avatar">
            @if (u.photoURL) {
              <img [src]="u.photoURL" [alt]="u.displayName ?? 'User'" />
            } @else {
              <span class="auth-widget__initials">{{ initials(u.displayName ?? u.email ?? '?') }}</span>
            }
          </span>
          <span class="auth-widget__name">{{ u.displayName ?? u.email }}</span>
          <app-icon name="expand_more" [size]="14" />
        </button>

        @if (menuOpen()) {
          <div class="auth-menu anim-scale-in" role="menu">
            <div class="auth-menu__head">
              <div class="auth-menu__name">{{ u.displayName ?? 'User' }}</div>
              @if (u.email) {
                <div class="auth-menu__email">{{ u.email }}</div>
              }
            </div>
            <button
              type="button"
              class="auth-menu__item"
              (click)="signOut()"
              role="menuitem"
            >
              <app-icon name="logout" [size]="14" />
              <span>{{ 'auth.signOut' | translate }}</span>
            </button>
          </div>
        }
      } @else {
        <button
          type="button"
          class="auth-widget auth-widget--signed-out"
          (click)="signIn()"
          [disabled]="signingIn()"
          [attr.aria-label]="'auth.signIn' | translate"
        >
          @if (signingIn()) {
            <app-icon name="progress_activity" [size]="14" [class.auth-widget__spin]="true" />
            <span>{{ 'auth.signingIn' | translate }}</span>
          } @else {
            <span class="auth-widget__google-g" aria-hidden="true">G</span>
            <span>{{ 'auth.signInWithGoogle' | translate }}</span>
          }
        </button>
      }
    }
  `,
  styles: [`
    .auth-widget {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 7px 10px;
      border-radius: var(--radius-sm);
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.05);
      color: var(--sidebar-text);
      font-size: 12px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: background var(--motion-fast), border-color var(--motion-fast);
      position: relative;

      &:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.15);
      }

      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      &__avatar {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        overflow: hidden;
        background: linear-gradient(135deg, var(--brand-400), var(--brand-600));
        display: grid;
        place-items: center;
        flex-shrink: 0;

        img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
      }

      &__initials {
        font-size: 10px;
        font-weight: 700;
        color: #fff;
        text-transform: uppercase;
      }

      &__name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      &__google-g {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #fff;
        color: #4285f4;
        display: grid;
        place-items: center;
        flex-shrink: 0;
      }

      &__spin {
        animation: var(--motion-spin);
      }
    }

    .auth-menu {
      position: absolute;
      bottom: calc(100% + 6px);
      left: 0;
      right: 0;
      background: var(--surface-0);
      border: 1px solid var(--surface-200);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      padding: var(--space-2);
      z-index: 100;
      transform-origin: bottom left;

      &__head {
        padding: var(--space-2) var(--space-3);
        border-bottom: 1px solid var(--surface-200);
        margin-bottom: var(--space-2);
      }

      &__name {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-strong);
      }

      &__email {
        font-size: 11px;
        color: var(--text-muted);
        margin-top: 2px;
      }

      &__item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 10px;
        border: none;
        background: transparent;
        color: var(--text-base);
        font-size: 13px;
        font-weight: 500;
        font-family: inherit;
        cursor: pointer;
        border-radius: var(--radius-sm);
        transition: background var(--motion-fast), color var(--motion-fast);

        &:hover {
          background: var(--surface-100);
          color: var(--text-strong);
        }
      }
    }
  `],
})
export class AuthWidgetComponent {
  private readonly auth = inject(AuthService);

  readonly cloudEnabled = this.auth.cloudEnabled;
  readonly user = this.auth.user;
  readonly signingIn = this.auth.signingIn;

  private readonly _menuOpen = signal(false);
  readonly menuOpen = this._menuOpen.asReadonly();

  toggleMenu(): void {
    this._menuOpen.update((v) => !v);
  }

  async signIn(): Promise<void> {
    try {
      await this.auth.signInWithGoogle();
    } catch (err) {
      console.error('[AuthWidget] Sign-in failed:', err);
    }
  }

  async signOut(): Promise<void> {
    this._menuOpen.set(false);
    await this.auth.signOut();
  }

  initials(name: string): string {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }
}
