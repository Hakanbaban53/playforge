import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { FirstLoginMergeService } from '../../core/services/first-login-merge.service';
import { IconComponent } from './icon.component';
import { ButtonComponent } from './button.component';

/**
 * First-login merge prompt.
 *
 * Renders as a modal-style banner across the bottom of the screen when
 * the user has just signed in AND has anonymous local data AND hasn't
 * dismissed the prompt yet.
 *
 * Two actions:
 *   - "Upload to my account" — runs the merge, uploads all local data
 *     to Firestore, then clears local storage. The prompt dismisses.
 *   - "Discard local data" — dismisses the prompt without uploading.
 *     Local data stays on this device but won't be in the cloud.
 *
 * Mounted once in app.html so it floats above every route. Reads
 * `FirstLoginMergeService.shouldPrompt` to decide visibility.
 */
@Component({
  selector: 'app-first-login-merge',
  standalone: true,
  imports: [TranslatePipe, IconComponent, ButtonComponent],
  template: `
    @if (shouldPrompt()) {
      <div class="merge-modal-overlay">
        <div class="merge-prompt" role="alertdialog" aria-labelledby="merge-prompt-title">
          <div class="merge-prompt__header">
            <div class="merge-prompt__icon">
              <app-icon name="cloud_upload" [size]="24" />
            </div>
            <h3 id="merge-prompt-title" class="merge-prompt__title">
              {{ 'merge.title' | translate }}
            </h3>
          </div>

          <div class="merge-prompt__body">
            <p class="merge-prompt__summary">
              {{ 'merge.summary' | translate }}
            </p>
            <ul class="merge-prompt__list">
              @if (summary().families > 0) {
                <li>
                  <app-icon name="inventory_2" [size]="14" />
                  <span>
                    {{ (summary().families === 1 ? 'merge.families_1' : 'merge.families') | translate: { count: summary().families } }}
                  </span>
                </li>
              }
              @if (summary().customers > 0) {
                <li>
                  <app-icon name="group" [size]="14" />
                  <span>
                    {{ (summary().customers === 1 ? 'merge.customers_1' : 'merge.customers') | translate: { count: summary().customers } }}
                  </span>
                </li>
              }
              @if (summary().invoices > 0) {
                <li>
                  <app-icon name="description" [size]="14" />
                  <span>
                    {{ (summary().invoices === 1 ? 'merge.invoices_1' : 'merge.invoices') | translate: { count: summary().invoices } }}
                  </span>
                </li>
              }
              @if (summary().favorites > 0) {
                <li>
                  <app-icon name="star" [size]="14" />
                  <span>
                    {{ (summary().favorites === 1 ? 'merge.favorites_1' : 'merge.favorites') | translate: { count: summary().favorites } }}
                  </span>
                </li>
              }
              @if (summary().hasReceiptLayout || summary().hasInvoiceDefaults || summary().hasCurrency) {
                <li>
                  <app-icon name="settings" [size]="14" />
                  <span>{{ 'merge.settings' | translate }}</span>
                </li>
              }
            </ul>
          </div>

          <div class="merge-prompt__actions">
            <app-button variant="ghost" size="md" (click)="dismiss()">
              {{ 'merge.discard' | translate }}
            </app-button>
            <app-button
              variant="primary"
              size="md"
              (click)="merge()"
              [loading]="merging()"
            >
              <app-icon name="cloud_upload" [size]="14" />
              {{ 'merge.upload' | translate }}
            </app-button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .merge-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: grid;
      place-items: center;
      z-index: 9999;
      animation: merge-fade-in var(--motion-base) var(--ease-out-quint) both;
    }

    .merge-prompt {
      width: min(520px, calc(100vw - 32px));
      background: var(--surface-0);
      border: 1px solid var(--surface-200);
      border-radius: var(--radius-xl);
      box-shadow: 
        0 20px 25px -5px rgba(0, 0, 0, 0.1), 
        0 10px 10px -5px rgba(0, 0, 0, 0.04),
        inset 0 1px 0 rgba(255, 255, 255, 0.1);
      padding: var(--space-6);
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
      z-index: 10000;
      animation: merge-scale-up var(--motion-base) var(--ease-out-quint) both;
      transform-origin: center center;

      &__header {
        display: flex;
        align-items: center;
        gap: var(--space-4);
      }

      &__icon {
        width: 48px;
        height: 48px;
        border-radius: 12px;
        background: var(--brand-50);
        color: var(--brand-600);
        display: grid;
        place-items: center;
        flex-shrink: 0;
      }

      &__title {
        font-size: 18px;
        font-weight: 700;
        color: var(--text-strong);
        margin: 0;
      }

      &__body {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }

      &__summary {
        font-size: 14px;
        color: var(--text-muted);
        margin: 0;
        line-height: 1.5;
      }

      &__list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-2) var(--space-3);

        @media (max-width: 480px) {
          grid-template-columns: 1fr;
        }

        li {
          display: inline-flex;
          align-items: center;
          gap: var(--space-2);
          font-size: 13px;
          color: var(--text-base);
          background: var(--surface-50);
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-md);
          border: 1px solid var(--surface-100);

          app-icon {
            color: var(--brand-600);
          }
        }
      }

      &__actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-3);
        align-items: center;
        border-top: 1px solid var(--surface-100);
        padding-top: var(--space-4);

        @media (max-width: 480px) {
          flex-direction: column-reverse;
          align-items: stretch;
          
          app-button {
            width: 100%;
          }
        }
      }
    }

    @keyframes merge-fade-in {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    @keyframes merge-scale-up {
      from {
        opacity: 0;
        transform: scale(0.95);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }
  `],
})
export class FirstLoginMergeComponent {
  private readonly mergeService = inject(FirstLoginMergeService);

  readonly shouldPrompt = this.mergeService.shouldPrompt;
  readonly summary = this.mergeService.localSummary;
  readonly merging = this.mergeService.merging;

  async merge(): Promise<void> {
    try {
      await this.mergeService.mergeAndClear();
    } catch (err) {
      console.error('[FirstLoginMerge] Merge failed:', err);
    }
  }

  dismiss(): void {
    this.mergeService.dismiss();
  }
}
