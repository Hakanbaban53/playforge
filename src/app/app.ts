import { Component, computed, inject, signal, DestroyRef, Type, isDevMode } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { NgComponentOutlet } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { IconComponent } from './shared/components/icon.component';
import { ToasterComponent } from './shared/components/toaster.component';
import { UpdateBannerComponent } from './shared/components/update-banner.component';
import { SyncIndicatorComponent } from './shared/components/sync-indicator.component';
import { AuthWidgetComponent } from './shared/components/auth-widget.component';
import { FirstLoginMergeComponent } from './shared/components/first-login-merge.component';
import { InvoiceService } from './core/services/invoice.service';
import { UpdateService } from './core/services/update.service';
import { environment } from '../environments/environment';

interface NavItem {
  labelKey: string;
  route: string;
  icon: string;
  descKey: string;
}

/**
 * Application shell — responsive sidebar + content area.
 *
 * Desktop (≥900px): fixed sidebar with hover-to-collapse toggle on the
 * brand icon. The toggle button is hidden by default and appears on hover.
 * Mobile (<900px): slide-in drawer with backdrop + top bar hamburger.
 *
 * Dev tools:
 *   The `<app-dev-tools>` panel is lazy-loaded via dynamic import only when
 *   `!environment.production`. In a production build, `environment.production`
 *   is statically `true` (via `fileReplacements` in `angular.json`), so the
 *   `if` branch is dead code and the bundler tree-shakes the entire
 *   DevToolsComponent + MockDataService + their icon references out of the
 *   production bundle. This keeps the dev-only mock-data seeder out of the
 *   shipped app with zero runtime cost.
 */
@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    NgComponentOutlet,
    IconComponent,
    ToasterComponent,
    TranslatePipe,
    UpdateBannerComponent,
    SyncIndicatorComponent,
    AuthWidgetComponent,
    FirstLoginMergeComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly invoice = inject(InvoiceService);
  readonly updateService = inject(UpdateService);

  protected readonly title = 'PlayForge';
  readonly version = environment.version;

  readonly sidebarCollapsed = signal(false);
  readonly mobileDrawerOpen = signal(false);
  /**
   * True for ~200ms after the mobile drawer starts closing. Keeps the
   * backdrop rendered during its exit fade — without this, `@if` would
   * remove the backdrop element the instant `mobileDrawerOpen()` flips
   * to false, and the exit animation could never play.
   */
  readonly mobileBackdropLeaving = signal(false);
  readonly isMobile = signal(false);

  /**
   * Lazily-loaded DevToolsComponent. Populated only in dev mode via a
   * dynamic import. Stays `null` in production builds, so the
   * `<ng-container *ngComponentOutlet>...` block renders nothing.
   */
  private readonly _devToolsComponent = signal<Type<unknown> | null>(null);
  readonly devToolsComponent = this._devToolsComponent.asReadonly();

  readonly navItems: readonly NavItem[] = [
    { labelKey: 'nav.catalog', route: '/catalog', icon: 'grid_view', descKey: 'nav.catalogDesc' },
    { labelKey: 'nav.configurator', route: '/configurator', icon: 'inventory_2', descKey: 'nav.configuratorDesc' },
    { labelKey: 'nav.invoice', route: '/invoice', icon: 'description', descKey: 'nav.invoiceDesc' },
    { labelKey: 'nav.customers', route: '/customers', icon: 'group', descKey: 'nav.customersDesc' },
    { labelKey: 'nav.receiptEditor', route: '/receipt-editor', icon: 'layers', descKey: 'nav.receiptEditorDesc' },
    { labelKey: 'nav.import', route: '/import', icon: 'upload', descKey: 'nav.importDesc' },
    { labelKey: 'nav.export', route: '/export', icon: 'download', descKey: 'nav.exportDesc' },
    { labelKey: 'nav.catalogManagement', route: '/catalog-management', icon: 'sell', descKey: 'nav.catalogManagementDesc' },
    { labelKey: 'nav.settings', route: '/settings', icon: 'settings', descKey: 'nav.settingsDesc' },
  ] as const;

  readonly lineCount = computed(() => this.invoice.active().lines.length);

  readonly showText = computed(() => {
    if (this.isMobile()) return this.mobileDrawerOpen();
    return !this.sidebarCollapsed();
  });

  constructor() {
    this.checkMobile();

    // Auto-cleanup resize listener via DestroyRef.
    const destroyRef = inject(DestroyRef);
    window.addEventListener('resize', this.onResizeBound, { passive: true });
    destroyRef.onDestroy(() => {
      window.removeEventListener('resize', this.onResizeBound);
    });

    // Lazy-load dev tools only in non-production builds.
    if (isDevMode()) {
      void import('./shared/components/dev-tools.component')
        .then((m) => this._devToolsComponent.set(m.DevToolsComponent))
        .catch((err) => console.warn('[DevTools] failed to load:', err));
    }
  }

  private readonly onResizeBound = (): void => this.checkMobile();

  private checkMobile(): void {
    this.isMobile.set(window.innerWidth < 900);
    if (!this.isMobile()) {
      this.mobileDrawerOpen.set(false);
    }
  }

  toggleSidebar(): void {
    if (this.isMobile()) {
      this.mobileDrawerOpen.update((v) => !v);
    } else {
      this.sidebarCollapsed.update((v) => !v);
    }
  }

  closeMobileDrawer(): void {
    if (!this.isMobile() || !this.mobileDrawerOpen()) return;
    // Close the drawer immediately (sidebar starts sliding out via its
    // existing transform transition), but keep the backdrop rendered for
    // ~200ms so its exit fade can play.
    this.mobileDrawerOpen.set(false);
    this.mobileBackdropLeaving.set(true);
    window.setTimeout(() => this.mobileBackdropLeaving.set(false), 200);
  }

  closeBackdrop(): void {
    this.closeMobileDrawer();
  }
}
