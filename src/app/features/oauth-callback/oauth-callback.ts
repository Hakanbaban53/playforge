import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService, OAuthErrorKind } from '../../core/services/auth.service';
import { IconComponent } from '../../shared/components/icon.component';
import { ButtonComponent } from '../../shared/components/button.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';

type CallbackStatus =
  | 'loading'      // consuming redirect result / waiting for auth state
  | 'prompt'       // no user, no redirect in flight — show "Sign in with Google"
  | 'success'      // token obtained, deep-link redirect in progress
  | 'error';       // something went wrong

/**
 * OAuth callback page.
 *
 * Serves as the landing page for the Tauri desktop deep-link OAuth flow:
 * the desktop app opens the system browser to `/oauth-callback`, the
 * user signs in with Google, and this page extracts the ID token and
 * redirects back to the app via the `playforge://oauth?token=...` deep
 * link. The desktop app's deep-link listener catches the redirect and
 * signs the user in via `signInWithCredential`.
 *
 * States:
 *   - `loading`: while `AuthService.completeOAuthCallbackFlow()` runs.
 *   - `prompt`:  no signed-in user and no pending redirect — user must
 *                click "Sign in with Google" to start the flow.
 *   - `success`: token obtained. Show a brief confirmation, then trigger
 *                the `playforge://` deep link. Also expose a manual
 *                "Open app" button in case the deep link doesn't fire
 *                automatically (mobile browsersoftware, popup blockers, etc.).
 *   - `error`:   redirect-result consumption failed, token retrieval
 *                failed, or Firebase isn't configured.
 *
 * The page is fully standalone (rendered outside the app shell), so it
 * pulls in the global stylesheet and uses design-system tokens directly.
 */
@Component({
  selector: 'app-oauth-callback',
  standalone: true,
  imports: [TranslatePipe, IconComponent, ButtonComponent, SpinnerComponent],
  template: `
    <div class="oauth-page">
      <div class="oauth-card surface-card">
        <!-- Brand header -->
        <div class="oauth-card__brand">
          <div class="oauth-card__logo">
            <app-icon name="inventory_2" [size]="28" />
          </div>
          <div class="oauth-card__brand-text">
            <span class="oauth-card__brand-name">PlayForge</span>
            <span class="oauth-card__brand-tag">{{ 'auth.callback.tagline' | translate }}</span>
          </div>
        </div>

        <!-- Loading -->
        @if (status() === 'loading') {
          <div class="oauth-state oauth-state--loading anim-scale-in">
            <div class="oauth-state__icon oauth-state__icon--loading">
              <app-spinner [size]="32" />
            </div>
            <h3 class="oauth-state__title">{{ 'auth.callback.loadingTitle' | translate }}</h3>
            <p class="oauth-state__body">{{ 'auth.callback.loadingBody' | translate }}</p>
          </div>
        }

        <!-- Prompt -->
        @if (status() === 'prompt') {
          <div class="oauth-state oauth-state--prompt anim-scale-in">
            <div class="oauth-state__icon oauth-state__icon--prompt">
              <span class="oauth-google-g" aria-hidden="true">G</span>
            </div>
            <h3 class="oauth-state__title">{{ 'auth.callback.promptTitle' | translate }}</h3>
            <p class="oauth-state__body">{{ 'auth.callback.promptBody' | translate }}</p>
            <app-button
              variant="primary"
              size="lg"
              [loading]="startingRedirect()"
              (click)="startSignIn()"
            >
              <span class="oauth-google-g oauth-google-g--small" aria-hidden="true">G</span>
              {{ 'auth.signInWithGoogle' | translate }}
            </app-button>
          </div>
        }

        <!-- Success -->
        @if (status() === 'success') {
          <div class="oauth-state oauth-state--success anim-scale-in">
            <div class="oauth-state__icon oauth-state__icon--success">
              <app-icon name="check" [size]="32" />
            </div>
            <h3 class="oauth-state__title">{{ 'auth.callback.successTitle' | translate }}</h3>
            <p class="oauth-state__body">{{ 'auth.callback.successBody' | translate }}</p>
            <a [href]="deepLinkUrl()" class="oauth-open-app">
              <app-icon name="arrow_back" [size]="16" />
              <span>{{ 'auth.callback.successOpenApp' | translate }}</span>
            </a>
            <p class="oauth-state__hint">{{ 'auth.callback.successHint' | translate }}</p>
          </div>
        }

        <!-- Error -->
        @if (status() === 'error') {
          <div class="oauth-state oauth-state--error anim-scale-in">
            <div class="oauth-state__icon oauth-state__icon--error">
              <app-icon name="error" [size]="32" />
            </div>
            <h3 class="oauth-state__title">{{ 'auth.callback.errorTitle' | translate }}</h3>
            <p class="oauth-state__body">{{ errorMessage() | translate }}</p>
            <div class="oauth-state__actions">
              <app-button variant="secondary" size="md" (click)="returnToApp()">
                <app-icon name="arrow_back" [size]="14" />
                {{ 'auth.callback.errorReturn' | translate }}
              </app-button>
              <app-button variant="primary" size="md" (click)="startSignIn()">
                <app-icon name="restart_alt" [size]="14" />
                {{ 'auth.callback.errorRetry' | translate }}
              </app-button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      min-height: 100dvh;
    }

    .oauth-page {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      min-height: 100dvh;
      padding: var(--space-5) var(--space-4);
      background: var(--app-bg);
      font-family: var(--font-sans);
      color: var(--text-base);
      animation: fade-in var(--motion-base) var(--ease-out-quint) both;
    }

    .oauth-card {
      width: min(440px, 100%);
      padding: var(--space-8) var(--space-6);
      display: flex;
      flex-direction: column;
      gap: var(--space-6);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-lg);
      background: var(--surface-0);

      @media (max-width: 480px) {
        padding: var(--space-6) var(--space-5);
        border-radius: var(--radius-lg);
      }
    }

    /* ---- Brand header ---- */
    .oauth-card__brand {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding-bottom: var(--space-4);
      border-bottom: 1px solid var(--surface-100);
    }

    .oauth-card__logo {
      width: 44px;
      height: 44px;
      border-radius: var(--radius-md);
      background: linear-gradient(135deg, var(--brand-500), var(--brand-700));
      color: var(--text-on-brand);
      display: grid;
      place-items: center;
      box-shadow: 0 4px 12px rgba(31, 157, 86, 0.25);
      flex-shrink: 0;
    }

    .oauth-card__brand-text {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }

    .oauth-card__brand-name {
      font-size: 17px;
      font-weight: 700;
      color: var(--text-strong);
      letter-spacing: -0.01em;
    }

    .oauth-card__brand-tag {
      font-size: 12px;
      color: var(--text-subtle);
    }

    /* ---- State container ---- */
    .oauth-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: var(--space-3);
    }

    .oauth-state__icon {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      flex-shrink: 0;
      margin-bottom: var(--space-2);
    }

    .oauth-state__icon--loading {
      background: var(--brand-50);
      color: var(--brand-600);
      box-shadow: inset 0 0 0 1px var(--brand-200);
    }

    .oauth-state__icon--prompt {
      background: var(--surface-100);
      box-shadow: inset 0 0 0 1px var(--surface-200);
    }

    .oauth-state__icon--success {
      background: var(--success-50);
      color: var(--success-500);
      box-shadow: inset 0 0 0 1px var(--success-500);
    }

    .oauth-state__icon--error {
      background: var(--danger-50);
      color: var(--danger-500);
      box-shadow: inset 0 0 0 1px var(--danger-500);
    }

    .oauth-state__title {
      font-size: 20px;
      font-weight: 700;
      color: var(--text-strong);
      margin: 0;
      letter-spacing: -0.01em;
    }

    .oauth-state__body {
      font-size: 14px;
      color: var(--text-muted);
      line-height: 1.55;
      margin: 0 0 var(--space-2);
      max-width: 32ch;
    }

    .oauth-state__hint {
      font-size: 12px;
      color: var(--text-subtle);
      margin-top: var(--space-2);
      line-height: 1.5;
    }

    .oauth-state__actions {
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
      justify-content: center;
      margin-top: var(--space-2);
    }

    /* ---- Google "G" badge ---- */
    .oauth-google-g {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #fff;
      color: #4285f4;
      display: grid;
      place-items: center;
      font-weight: 700;
      font-size: 13px;
      font-family: var(--font-sans);
      flex-shrink: 0;
    }

    .oauth-state__icon--prompt .oauth-google-g {
      width: 32px;
      height: 32px;
      font-size: 20px;
    }

    .oauth-google-g--small {
      width: 16px;
      height: 16px;
      font-size: 11px;
    }

    .oauth-open-app {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      padding: 12px 22px;
      border-radius: var(--radius-md);
      background: var(--brand-600);
      color: var(--text-on-brand);
      font-size: 15px;
      font-weight: 600;
      text-decoration: none;
      transition: background var(--motion-fast), box-shadow var(--motion-fast);
      margin-top: var(--space-1);
    }

    .oauth-open-app:hover {
      background: var(--brand-700);
      box-shadow: var(--shadow-sm);
      text-decoration: none;
    }

    .oauth-open-app:active {
      transform: translateY(1px);
    }
  `],
})
export class OAuthCallbackPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  private static readonly REDIRECT_FLAG = 'playforge_oauth_redirect';

  readonly status = signal<CallbackStatus>('loading');
  readonly errorMessage = signal<string>('auth.callback.errorDefault');
  readonly deepLinkUrl = signal<string>('');
  readonly startingRedirect = signal<boolean>(false);

  private handled = false;

  ngOnInit(): void {
    if (!this.auth.cloudEnabled) {
      this.status.set('error');
      this.errorMessage.set('auth.callback.errorConfig');
      return;
    }

    const redirectInProgress = sessionStorage.getItem(OAuthCallbackPage.REDIRECT_FLAG);
    if (redirectInProgress) {
      sessionStorage.removeItem(OAuthCallbackPage.REDIRECT_FLAG);
    }

    void this.consumeFlow();
  }

  private async consumeFlow(): Promise<void> {
    this.status.set('loading');

    try {
      const result = await this.auth.completeOAuthCallbackFlow(8000);
      if (result) {
        this.handleSuccess(result.idToken);
      } else {
        this.status.set('prompt');
      }
    } catch (err) {
      this.handleError(err);
    }
  }

  async startSignIn(): Promise<void> {
    if (this.startingRedirect()) return;
    this.startingRedirect.set(true);

    try {
      sessionStorage.setItem(OAuthCallbackPage.REDIRECT_FLAG, 'true');
      await this.auth.signInWithGoogleRedirect();
    } catch (err) {
      sessionStorage.removeItem(OAuthCallbackPage.REDIRECT_FLAG);
      this.handleError(err);
    } finally {
      this.startingRedirect.set(false);
    }
  }

  returnToApp(): void {
    window.location.href = '/';
  }

  private handleSuccess(idToken: string): void {
    if (this.handled) return;
    this.handled = true;

    const url = `playforge://oauth?token=${encodeURIComponent(idToken)}`;
    this.deepLinkUrl.set(url);
    this.status.set('success');

    const timeoutId = window.setTimeout(() => {
      window.location.href = url;
    }, 1200);

    this.destroyRef.onDestroy(() => window.clearTimeout(timeoutId));
  }

  private handleError(err: unknown): void {
    const kind: OAuthErrorKind = this.auth.classifyOAuthError(err);
    this.errorMessage.set(`auth.callback.error${kind.charAt(0).toUpperCase()}${kind.slice(1)}`);
    this.status.set('error');
  }
}
