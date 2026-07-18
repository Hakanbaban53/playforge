import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { CatalogService } from '../../core/services/catalog.service';
import { InvoiceService } from '../../core/services/invoice.service';
import { InvoiceDefaultsService } from '../../core/services/invoice-defaults.service';
import { ThemeService, ThemeMode } from '../../core/services/theme.service';
import { I18nService, AppLanguage } from '../../core/services/i18n.service';
import { CurrencyService, CurrencyCode } from '../../core/services/currency.service';
import { UpdateService } from '../../core/services/update.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { AuthService } from '../../core/services/auth.service';
import { CustomersService } from '../../core/services/customers.service';
import { FavoritesService } from '../../core/services/favorites.service';
import { ReceiptLayoutService } from '../../core/services/receipt-layout.service';
import { PaperSize } from '../../core/models/invoice.model';
import { IconComponent } from '../../shared/components/icon.component';
import { ButtonComponent } from '../../shared/components/button.component';
import { SpinnerComponent } from '../../shared/components/spinner.component';

/**
 * Settings page — appearance (theme + language), currency rates, invoice
 * defaults, app updates (Tauri only), catalog actions, danger zone.
 */
@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [IconComponent, ButtonComponent, SpinnerComponent, TranslatePipe],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  private readonly catalog = inject(CatalogService);
  private readonly invoice = inject(InvoiceService);
  private readonly invoiceDefaults = inject(InvoiceDefaultsService);
  private readonly customersSvc = inject(CustomersService);
  private readonly favoritesSvc = inject(FavoritesService);
  private readonly receiptLayoutSvc = inject(ReceiptLayoutService);
  private readonly themeService = inject(ThemeService);
  private readonly i18n = inject(I18nService);
  private readonly currencyService = inject(CurrencyService);
  private readonly updateSvc = inject(UpdateService);
  private readonly confirmSvc = inject(ConfirmService);
  readonly auth = inject(AuthService);

  readonly families = this.catalog.families;
  readonly variants = this.catalog.variants;
  readonly updateService = this.updateSvc;
  readonly isTauri = () => UpdateService.isTauri();

  /** Count of unique parts across all families (de-duplicated by sku). */
  readonly totalParts = computed(() => {
    const skus = new Set<string>();
    for (const f of this.families()) {
      for (const p of f.availableParts) skus.add(p.sku);
    }
    return skus.size;
  });

  readonly themeMode = this.themeService.mode;
  readonly themeModes: ThemeMode[] = ['light', 'dark', 'system'];
  setTheme(m: ThemeMode): void { this.themeService.setMode(m); }

  readonly currentLang = this.i18n.lang;
  readonly languages: AppLanguage[] = this.i18n.languages;
  setLang(l: AppLanguage): void { this.i18n.use(l); }

  readonly rates = this.currencyService.rates;
  readonly supportedCurrencies = this.currencyService.supportedCurrencies;
  readonly baseCurrency = this.currencyService.base;

  rateFor(code: CurrencyCode): number {
    return this.rates()[code];
  }

  updateRate(code: CurrencyCode, event: Event): void {
    const v = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(v)) {
      void this.currencyService.setRate(code, v);
    }
  }

  readonly defaults = this.invoiceDefaults.defaults;

  setDefaultPaper(event: Event): void {
    const v = (event.target as HTMLSelectElement).value as PaperSize;
    void this.invoiceDefaults.update({ paperSize: v });
  }

  setDefaultCurrency(event: Event): void {
    const v = (event.target as HTMLSelectElement).value;
    void this.invoiceDefaults.update({ currency: v });
  }

  setDefaultVat(event: Event): void {
    const v = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(v)) {
      void this.invoiceDefaults.update({ vatPercent: v });
    }
  }

  async clearCatalog(): Promise<void> {
    if (!await this.confirmSvc.confirm(this.i18n.t('settings.resetConfirm'), 'Reset catalog')) return;
    await this.catalog.clearAll();
  }

  async clearInvoice(): Promise<void> {
    if (!await this.confirmSvc.confirm(this.i18n.t('settings.clearInvoiceConfirm'), 'Clear invoice')) return;
    await this.invoice.clearLines();
  }

  async wipeAll(): Promise<void> {
    const isCloud = this.auth.isAuthenticated();
    const confirmMsg = isCloud
      ? this.i18n.t('settings.wipeConfirmCloud')
      : this.i18n.t('settings.wipeConfirmLocal');

    if (!await this.confirmSvc.confirm(confirmMsg, 'Wipe all data')) return;

    await this.catalog.clearAll();
    await this.customersSvc.clearAll();
    await this.favoritesSvc.clear();
    await this.invoice.replaceAllSaved([]);
    await this.invoice.clearLines();
    await this.receiptLayoutSvc.resetToDefault();

    if (typeof localStorage !== 'undefined') {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('pgpos:')) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    }

    await this.wipeIndexedDB();

    location.reload();
  }

  private wipeIndexedDB(): Promise<void> {
    if (typeof indexedDB === 'undefined') return Promise.resolve();
    return new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('pgpos-files');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  }
}
