import { Component, computed, inject, signal, DestroyRef } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { IconComponent } from './shared/components/icon.component';
import { ToasterComponent } from './shared/components/toaster.component';
import { InvoiceService } from './core/services/invoice.service';
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
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, ToasterComponent, TranslatePipe],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly invoice = inject(InvoiceService);

  protected readonly title = 'PlayForge';
  /** App version, injected at build time (see `src/environments/`). */
  readonly version = environment.version;

  readonly sidebarCollapsed = signal(false);
  readonly mobileDrawerOpen = signal(false);
  readonly isMobile = signal(false);

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
    if (this.isMobile()) {
      this.mobileDrawerOpen.set(false);
    }
  }

  closeBackdrop(): void {
    this.mobileDrawerOpen.set(false);
  }
}
