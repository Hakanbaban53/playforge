import { Routes } from '@angular/router';

/**
 * Top-level routes — one per feature.
 *
 * Every feature page is lazy-loaded via `loadComponent` so the initial
 * bundle stays small. Each feature component stands alone (no NgModules).
 */
export const routes: Routes = [
  { path: '', redirectTo: 'catalog', pathMatch: 'full' },
  {
    path: 'catalog',
    title: 'Catalog · PlayForge',
    loadComponent: () =>
      import('./features/catalog/catalog-page').then((m) => m.CatalogPage),
  },
  {
    path: 'configurator',
    title: 'Configurator · PlayForge',
    loadComponent: () =>
      import('./features/configurator/configurator-page').then(
        (m) => m.ConfiguratorPage,
      ),
  },
  {
    path: 'invoice',
    title: 'Invoice · PlayForge',
    loadComponent: () =>
      import('./features/invoice/invoice-page').then((m) => m.InvoicePage),
  },
  {
    path: 'receipt-editor',
    title: 'Receipt Editor · PlayForge',
    loadComponent: () =>
      import('./features/receipt-editor/receipt-editor-page').then(
        (m) => m.ReceiptEditorPage,
      ),
  },
  {
    path: 'import',
    title: 'Excel Import · PlayForge',
    loadComponent: () =>
      import('./features/import/import-page').then((m) => m.ImportPage),
  },
  {
    path: 'export',
    title: 'Export · PlayForge',
    loadComponent: () =>
      import('./features/export/export-page').then((m) => m.ExportPage),
  },
  {
    path: 'catalog-management',
    title: 'Catalog Management · PlayForge',
    loadComponent: () =>
      import('./features/catalog-management/catalog-management-page').then(
        (m) => m.CatalogManagementPage,
      ),
  },
  {
    path: 'customers',
    title: 'Customers · PlayForge',
    loadComponent: () =>
      import('./features/customers/customers-page').then((m) => m.CustomersPage),
  },
  {
    path: 'settings',
    title: 'Settings · PlayForge',
    loadComponent: () =>
      import('./features/settings/settings-page').then((m) => m.SettingsPage),
  },
  {
    path: 'oauth-callback',
    title: 'Authentication · PlayForge',
    loadComponent: () =>
      import('./features/oauth-callback/oauth-callback').then((m) => m.OAuthCallbackPage),
  },
  { path: '**', redirectTo: 'catalog' },
];
