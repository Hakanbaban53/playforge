import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { UpdateService } from '../../core/services/update.service';
import { IconComponent } from './icon.component';
import { ButtonComponent } from './button.component';

/**
 * Floating update banner component.
 * Displays when a new version of the app is available.
 * Animates in from the bottom right.
 */
@Component({
  selector: 'app-update-banner',
  standalone: true,
  imports: [IconComponent, ButtonComponent, TranslatePipe],
  template: `
    @if (updateService.updateAvailable(); as update) {
      <div class="update-banner" role="alert" aria-live="assertive">
        <div class="update-banner__header">
          <app-icon name="system_update_alt" class="update-banner__icon" [size]="20" />
          <div class="update-banner__title-wrapper">
            <h4 class="update-banner__title">{{ 'settings.appUpdates' | translate }}</h4>
            <p class="update-banner__subtitle">{{ 'settings.updateAvailableDesc' | translate: { version: update.version } }}</p>
          </div>
          <button type="button" class="update-banner__close" (click)="updateService.dismiss()" [attr.aria-label]="'common.close' | translate">
            <app-icon name="close" [size]="16" />
          </button>
        </div>

        @if (updateService.downloading()) {
          <div class="update-banner__progress-wrapper">
            <div class="update-banner__progress-bar">
              <div class="update-banner__progress-fill" [style.width.%]="updateService.progress()?.percentage ?? 0"></div>
            </div>
            <span class="update-banner__progress-text">{{ updateService.progress()?.percentage?.toFixed(0) ?? 0 }}%</span>
          </div>
        } @else {
          <div class="update-banner__actions">
            <button type="button" class="update-banner__dismiss-btn" (click)="updateService.dismiss()">
              {{ 'common.dismiss' | translate }}
            </button>
            <app-button variant="primary" size="sm" (click)="updateService.downloadAndInstall()">
              <app-icon name="download" [size]="14" />
              {{ 'settings.downloadAndInstall' | translate }}
            </app-button>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .update-banner {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 360px;
      max-width: calc(100vw - 48px);
      background: var(--surface-0);
      box-shadow: 0 0 0 1px var(--surface-200), var(--shadow-lg);
      border-radius: var(--radius-md);
      padding: 16px;
      z-index: 2000;
      display: flex;
      flex-direction: column;
      gap: 12px;
      animation: update-slide-up var(--motion-base) cubic-bezier(0.16, 1, 0.3, 1);

      @supports (backdrop-filter: blur(8px)) {
        background: rgba(var(--surface-0-rgb, 255, 255, 255), 0.85);
        backdrop-filter: blur(8px);
      }

      &__header {
        display: flex;
        align-items: flex-start;
        gap: 12px;
      }

      &__icon {
        color: var(--brand-500);
        flex-shrink: 0;
        margin-top: 2px;
        display: flex;
        align-items: center;
      }

      &__title-wrapper {
        flex: 1;
        min-width: 0;
      }

      &__title {
        margin: 0 0 2px;
        font-size: 14px;
        font-weight: 600;
        color: var(--text-strong);
      }

      &__subtitle {
        margin: 0;
        font-size: 12px;
        color: var(--text-muted);
        line-height: 1.4;
      }

      &__close {
        border: none;
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        padding: 4px;
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        margin-top: -4px;
        margin-right: -4px;
        transition: background var(--motion-fast), color var(--motion-fast);

        &:hover {
          background: var(--surface-100);
          color: var(--text-strong);
        }
      }

      &__actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 12px;
      }

      &__dismiss-btn {
        border: none;
        background: transparent;
        color: var(--text-muted);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        padding: 6px 12px;
        border-radius: var(--radius-sm);
        transition: background var(--motion-fast), color var(--motion-fast);

        &:hover {
          background: var(--surface-100);
          color: var(--text-strong);
        }
      }

      &__progress-wrapper {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-top: 4px;
      }

      &__progress-bar {
        flex: 1;
        height: 6px;
        background: var(--surface-200);
        border-radius: 999px;
        overflow: hidden;
      }

      &__progress-fill {
        height: 100%;
        background: var(--brand-500);
        border-radius: 999px;
        transition: width var(--motion-fast) ease-out;
      }

      &__progress-text {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-strong);
        min-width: 32px;
        text-align: right;
      }
    }

    @keyframes update-slide-up {
      from {
        transform: translateY(24px) scale(0.96);
        opacity: 0;
      }
      to {
        transform: translateY(0) scale(1);
        opacity: 1;
      }
    }
  `],
})
export class UpdateBannerComponent {
  readonly updateService = inject(UpdateService);
}
