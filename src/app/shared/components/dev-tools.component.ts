import { Component, computed, inject, signal, effect, HostBinding } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { environment } from '../../../environments/environment';
import { MockDataService } from '../../core/services/mock-data.service';
import { ToastService } from '../../core/services/toast.service';
import { CatalogService } from '../../core/services/catalog.service';
import { CustomersService } from '../../core/services/customers.service';
import { InvoiceService } from '../../core/services/invoice.service';
import { FavoritesService } from '../../core/services/favorites.service';
import { IconComponent } from './icon.component';

/**
 * Dev-mode mock data panel.
 *
 * Renders ONLY when `!environment.production`. Mounted once at the app
 * shell level (`app.html`), so it floats above every route.
 *
 * UX:
 *   - Collapsed: small floating pill in the bottom-right corner with a
 *     science/beaker icon and "DEV" label.
 *   - Expanded: card with live entity counts, one-click seed buttons per
 *     entity, a "Seed all" orchestrator, and a "Wipe all data" danger
 *     action.
 *
 * The seed buttons call `MockDataService` and then surface a toast so the
 * user gets feedback that the injection happened (and how many records
 * were added).
 *
 * Theme:
 *   - Uses design tokens (var(--surface-0), var(--brand-500), etc.) so the
 *     panel automatically picks up light/dark mode.
 *   - The danger action uses the danger palette so it's visually distinct.
 *
 * Accessibility:
 *   - The collapsed pill is a `<button>` with aria-label.
 *   - The expanded panel has role="dialog" and aria-label.
 *   - Close button has aria-label.
 *
 * Why a separate component (not embedded in settings)?
 *   - Devs need it available on every page without navigating anywhere.
 *   - Floating keeps it out of the way of normal UX testing.
 *   - It's tree-shaken out of production builds because the host element
 *     is wrapped in `@if (!environment.production)`.
 */
@Component({
  selector: 'app-dev-tools',
  standalone: true,
  imports: [IconComponent, TranslatePipe],
  template: `
    @if (!isProduction) {
      <!-- Collapsed: floating pill -->
      @if (!open()) {
        <button
          type="button"
          class="dev-pill"
          (click)="toggle()"
          [attr.aria-label]="'dev.title' | translate"
          [attr.aria-expanded]="open()"
        >
          <app-icon name="science" [size]="16" />
          <span class="dev-pill__label">{{ 'dev.label' | translate }}</span>
          <span class="dev-pill__dot" aria-hidden="true"></span>
        </button>
      }

      <!-- Expanded: panel -->
      @if (open()) {
        <div
          class="dev-panel anim-scale-in"
          role="dialog"
          [attr.aria-label]="'dev.title' | translate"
        >
          <header class="dev-panel__head">
            <div class="dev-panel__title">
              <app-icon name="science" [size]="16" />
              <span>{{ 'dev.title' | translate }}</span>
            </div>
            <button
              type="button"
              class="dev-panel__close"
              (click)="toggle()"
              [attr.aria-label]="'common.close' | translate"
            >
              <app-icon name="close" [size]="16" />
            </button>
          </header>

          <!-- Live counts -->
          <section class="dev-counts" [attr.aria-label]="'dev.currentCounts' | translate">
            <div class="dev-count">
              <span class="dev-count__value">{{ counts().families }}</span>
              <span class="dev-count__label">{{ 'dev.countFamilies' | translate }}</span>
            </div>
            <div class="dev-count">
              <span class="dev-count__value">{{ counts().variants }}</span>
              <span class="dev-count__label">{{ 'dev.countVariants' | translate }}</span>
            </div>
            <div class="dev-count">
              <span class="dev-count__value">{{ counts().customers }}</span>
              <span class="dev-count__label">{{ 'dev.countCustomers' | translate }}</span>
            </div>
            <div class="dev-count">
              <span class="dev-count__value">{{ counts().invoices }}</span>
              <span class="dev-count__label">{{ 'dev.countInvoices' | translate }}</span>
            </div>
            <div class="dev-count">
              <span class="dev-count__value">{{ counts().favorites }}</span>
              <span class="dev-count__label">{{ 'dev.countFavorites' | translate }}</span>
            </div>
          </section>

          <!-- Seed actions -->
          <section class="dev-actions">
            <button type="button" class="dev-btn" (click)="seedCatalog()" [disabled]="busy()">
              <app-icon name="inventory_2" [size]="15" />
              <span>{{ 'dev.seedCatalog' | translate }}</span>
            </button>
            <button type="button" class="dev-btn" (click)="seedCustomers()" [disabled]="busy()">
              <app-icon name="group" [size]="15" />
              <span>{{ 'dev.seedCustomers' | translate }}</span>
            </button>
            <button type="button" class="dev-btn" (click)="seedFavorites()" [disabled]="busy()">
              <app-icon name="star" [size]="15" />
              <span>{{ 'dev.seedFavorites' | translate }}</span>
            </button>
            <button type="button" class="dev-btn" (click)="seedInvoices()" [disabled]="busy()">
              <app-icon name="description" [size]="15" />
              <span>{{ 'dev.seedInvoices' | translate }}</span>
            </button>
          </section>

          <!-- Primary + danger -->
          <section class="dev-primary-row">
            <button
              type="button"
              class="dev-btn dev-btn--primary"
              (click)="seedAll()"
              [disabled]="busy()"
            >
              <app-icon name="auto_awesome" [size]="15" />
              <span>{{ 'dev.seedAll' | translate }}</span>
            </button>
            <button
              type="button"
              class="dev-btn dev-btn--danger"
              (click)="wipeAll()"
              [disabled]="busy()"
            >
              <app-icon name="delete_sweep" [size]="15" />
              <span>{{ 'dev.wipeAll' | translate }}</span>
            </button>
          </section>

          <p class="dev-hint">{{ 'dev.hint' | translate }}</p>
        </div>
      }
    }
  `,
  styles: [`
    :host {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 9500;
      pointer-events: none;
      /* Container itself doesn't capture clicks; children re-enable. */
    }

    /* ====================== Collapsed pill ====================== */
    .dev-pill {
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      border: 1px solid var(--surface-300);
      border-radius: 999px;
      background: var(--surface-0);
      color: var(--text-base);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      cursor: pointer;
      box-shadow: var(--shadow-md);
      transition: transform var(--motion-fast), box-shadow var(--motion-fast),
                  border-color var(--motion-fast);

      &:hover {
        transform: translateY(-1px);
        box-shadow: var(--shadow-lg);
        border-color: var(--brand-400);
      }

      &:active {
        transform: translateY(0);
      }

      &:focus-visible {
        outline: none;
        box-shadow: var(--shadow-md), 0 0 0 3px var(--brand-focus-ring);
      }

      &__label {
        color: var(--text-strong);
      }

      &__dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--brand-500);
        animation: pulse-soft 1.8s ease-in-out infinite;
      }
    }

    /* ====================== Expanded panel ====================== */
    .dev-panel {
      pointer-events: auto;
      width: 320px;
      max-width: calc(100vw - 32px);
      background: var(--surface-0);
      border: 1px solid var(--surface-200);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      padding: var(--space-3) var(--space-4) var(--space-4);
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      transform-origin: bottom right;
    }

    .dev-panel__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .dev-panel__title {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 700;
      color: var(--text-strong);
      letter-spacing: 0.04em;
      text-transform: uppercase;

      app-icon {
        color: var(--brand-600);
      }
    }

    .dev-panel__close {
      border: none;
      background: transparent;
      color: var(--text-subtle);
      cursor: pointer;
      width: 24px;
      height: 24px;
      border-radius: var(--radius-sm);
      display: grid;
      place-items: center;
      transition: background var(--motion-fast), color var(--motion-fast);

      &:hover {
        background: var(--surface-100);
        color: var(--text-base);
      }

      &:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px var(--brand-focus-ring);
      }
    }

    /* ====================== Counts row ====================== */
    .dev-counts {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 6px;
      padding: 8px;
      background: var(--surface-50);
      border-radius: var(--radius-md);
      box-shadow: inset 0 0 0 1px var(--surface-200);
    }

    .dev-count {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      text-align: center;

      &__value {
        font-size: 16px;
        font-weight: 700;
        color: var(--brand-600);
        font-variant-numeric: tabular-nums;
        line-height: 1.1;
      }

      &__label {
        font-size: 9px;
        color: var(--text-subtle);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        line-height: 1.1;
      }
    }

    /* ====================== Action buttons ====================== */
    .dev-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }

    .dev-primary-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      padding-top: 6px;
      border-top: 1px dashed var(--surface-200);
    }

    .dev-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 10px;
      border: 1px solid var(--surface-300);
      border-radius: var(--radius-sm);
      background: var(--surface-0);
      color: var(--text-base);
      font-size: 12px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: background var(--motion-fast), border-color var(--motion-fast),
                  color var(--motion-fast), transform var(--motion-fast);

      &:hover:not(:disabled) {
        border-color: var(--brand-400);
        color: var(--brand-700);
        background: var(--surface-50);
      }

      &:active:not(:disabled) {
        transform: translateY(1px);
      }

      &:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px var(--brand-focus-ring);
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      &--primary {
        background: var(--brand-600);
        border-color: var(--brand-600);
        color: var(--text-on-brand);

        &:hover:not(:disabled) {
          background: var(--brand-700);
          border-color: var(--brand-700);
          color: var(--text-on-brand);
        }
      }

      &--danger {
        background: var(--surface-0);
        border-color: var(--danger-500);
        color: var(--danger-500);

        &:hover:not(:disabled) {
          background: var(--danger-50);
          color: var(--danger-700);
        }
      }
    }

    .dev-hint {
      font-size: 10px;
      color: var(--text-subtle);
      line-height: 1.4;
      margin: 0;
      text-align: center;
    }

    /* Mobile: pull the panel up off the bottom edge and shrink width */
    @media (max-width: 480px) {
      :host {
        bottom: 12px;
        right: 12px;
      }

      .dev-panel {
        width: calc(100vw - 24px);
      }
    }
  `],
})
export class DevToolsComponent {
  private readonly mock = inject(MockDataService);
  private readonly toast = inject(ToastService);
  private readonly catalog = inject(CatalogService);
  private readonly customersSvc = inject(CustomersService);
  private readonly invoice = inject(InvoiceService);
  private readonly favorites = inject(FavoritesService);

  /** True in production builds — the entire template no-ops. */
  readonly isProduction = environment.production;

  /** Panel open/closed state. Persisted to localStorage so it survives reloads. */
  readonly open = signal(this.loadOpenState());

  /** True while a seed/wipe operation is in flight (disables buttons). */
  readonly busy = signal(false);

  /** Live entity counts — re-computed whenever any underlying signal changes. */
  readonly counts = computed(() => {
    // Touch each signal so this computed re-evaluates on changes.
    const families = this.catalog.families().length;
    const variants = this.catalog.variants().length;
    const customers = this.customersSvc.customers().length;
    // listSaved() reads savedVersion() internally, so this re-evaluates on save/delete.
    const invoices = this.invoice.listSaved().length;
    const favorites = this.favorites.count();

    return { families, variants, customers, invoices, favorites };
  });

  constructor() {
    // Persist open state across reloads.
    effect(() => {
      try {
        localStorage.setItem('pgpos:dev-tools:open', JSON.stringify(this.open()));
      } catch {
        // Ignore storage failures (private mode, quota, etc.) — non-critical.
      }
    });
  }

  /**
   * The :host container never captures clicks — only its children do.
   * This lets clicks pass through the empty space around the floating panel.
   */
  @HostBinding('style.pointer-events')
  readonly hostPointerEvents = 'none';

  toggle(): void {
    this.open.update((v) => !v);
  }

  // ---------------------------------------------------------------------------
  // Seed actions — each surfaces a toast with the count.
  // ---------------------------------------------------------------------------

  seedCatalog(): void {
    this.busy.set(true);
    try {
      const n = this.mock.seedCatalog();
      this.toast.success('dev.toastCatalogSeeded', { count: n });
    } catch (err) {
      console.error('[DevTools] seedCatalog failed:', err);
      this.toast.error('dev.toastSeedFailed');
    } finally {
      this.busy.set(false);
    }
  }

  seedCustomers(): void {
    this.busy.set(true);
    try {
      const n = this.mock.seedCustomers();
      this.toast.success('dev.toastCustomersSeeded', { count: n });
    } catch (err) {
      console.error('[DevTools] seedCustomers failed:', err);
      this.toast.error('dev.toastSeedFailed');
    } finally {
      this.busy.set(false);
    }
  }

  seedFavorites(): void {
    this.busy.set(true);
    try {
      const n = this.mock.seedFavorites();
      this.toast.success('dev.toastFavoritesSeeded', { count: n });
    } catch (err) {
      console.error('[DevTools] seedFavorites failed:', err);
      this.toast.error('dev.toastSeedFailed');
    } finally {
      this.busy.set(false);
    }
  }

  seedInvoices(): void {
    this.busy.set(true);
    try {
      const n = this.mock.seedInvoices();
      this.toast.success('dev.toastInvoicesSeeded', { count: n });
    } catch (err) {
      console.error('[DevTools] seedInvoices failed:', err);
      this.toast.error('dev.toastSeedFailed');
    } finally {
      this.busy.set(false);
    }
  }

  seedAll(): void {
    this.busy.set(true);
    try {
      const result = this.mock.seedAll();
      this.toast.success('dev.toastAllSeeded', {
        families: result.families,
        customers: result.customers,
        favorites: result.favorites,
        invoices: result.invoices,
      });
    } catch (err) {
      console.error('[DevTools] seedAll failed:', err);
      this.toast.error('dev.toastSeedFailed');
    } finally {
      this.busy.set(false);
    }
  }

  wipeAll(): void {
    this.busy.set(true);
    try {
      this.mock.wipeAll();
      this.toast.warn('dev.toastWiped');
    } catch (err) {
      console.error('[DevTools] wipeAll failed:', err);
      this.toast.error('dev.toastWipeFailed');
    } finally {
      this.busy.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private loadOpenState(): boolean {
    try {
      const raw = localStorage.getItem('pgpos:dev-tools:open');
      return raw ? JSON.parse(raw) === true : false;
    } catch {
      return false;
    }
  }
}
