import { Routes } from '@angular/router';

/**
 * Top-level routes — one per feature.
 *
 * Every feature page is lazy-loaded via `loadComponent` so the initial
 * bundle stays small. Each feature component stands alone (no NgModules).
 *
 * Page titles use `data.titleKey` (an i18n key) instead of a hardcoded
 * `title:` string. The TranslatableTitleStrategy reads this key, translates
 * it, and appends ` · ${appName}`. When the user switches languages, the
 * tab title re-translates automatically.
 */
export const routes: Routes = [
  { path: '', redirectTo: 'catalog', pathMatch: 'full' },
  {
    path: 'catalog',
    data: { titleKey: 'nav.catalog' },
    loadComponent: () =>
      import('./features/catalog/catalog-page').then((m) => m.CatalogPage),
  },
  {
    path: 'configurator',
    data: { titleKey: 'nav.configurator' },
    loadComponent: () =>
      import('./features/configurator/configurator-page').then(
        (m) => m.ConfiguratorPage,
      ),
  },
  {
    path: 'invoice',
    data: { titleKey: 'nav.invoice' },
    loadComponent: () =>
      import('./features/invoice/invoice-page').then((m) => m.InvoicePage),
  },
  {
    path: 'receipt-editor',
    data: { titleKey: 'nav.receiptEditor' },
    loadComponent: () =>
      import('./features/receipt-editor/receipt-editor-page').then(
        (m) => m.ReceiptEditorPage,
      ),
  },
  {
    path: 'import',
    data: { titleKey: 'nav.import' },
    loadComponent: () =>
      import('./features/import/import-page').then((m) => m.ImportPage),
  },
  {
    path: 'export',
    data: { titleKey: 'nav.export' },
    loadComponent: () =>
      import('./features/export/export-page').then((m) => m.ExportPage),
  },
  {
    path: 'catalog-management',
    data: { titleKey: 'nav.catalogManagement' },
    loadComponent: () =>
      import('./features/catalog-management/catalog-management-page').then(
        (m) => m.CatalogManagementPage,
      ),
  },
  {
    path: 'customers',
    data: { titleKey: 'nav.customers' },
    loadComponent: () =>
      import('./features/customers/customers-page').then((m) => m.CustomersPage),
  },
  {
    path: 'settings',
    data: { titleKey: 'nav.settings' },
    loadComponent: () =>
      import('./features/settings/settings-page').then((m) => m.SettingsPage),
  },
  {
    path: 'oauth-callback',
    data: { titleKey: 'auth.account' },
    loadComponent: () =>
      import('./features/oauth-callback/oauth-callback').then((m) => m.OAuthCallbackPage),
  },
  { path: '**', redirectTo: 'catalog' },
];
