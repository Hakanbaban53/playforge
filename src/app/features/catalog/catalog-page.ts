import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { CatalogService } from '../../core/services/catalog.service';
import { ConfiguratorService } from '../../core/services/configurator.service';
import { InvoiceService } from '../../core/services/invoice.service';
import { FavoritesService } from '../../core/services/favorites.service';
import { ToastService } from '../../core/services/toast.service';
import { ProductCategory } from '../../core/models/catalog.model';
import { lineFromResolved } from '../../core/models/invoice.model';
import { IconComponent } from '../../shared/components/icon.component';
import { ButtonComponent } from '../../shared/components/button.component';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { ResolvedImgComponent } from '../../shared/components/resolved-img.component';
import { getPrimaryImageUrl } from '../../core/utils/receipt-utils';

/**
 * Catalog page — browse product families and their variants.
 *
 * Empty state: when the catalog has no families, the page surfaces a CTA
 * directing the user to Catalog Management or the Excel import flow.
 */
@Component({
  selector: 'app-catalog-page',
  standalone: true,
  imports: [
    IconComponent,
    ButtonComponent,
    MoneyPipe,
    TranslatePipe,
    ResolvedImgComponent,
  ],
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.scss',
})
export class CatalogPage {
  private readonly catalog = inject(CatalogService);
  private readonly configurator = inject(ConfiguratorService);
  private readonly invoice = inject(InvoiceService);
  private readonly favorites = inject(FavoritesService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly families = this.catalog.families;
  readonly resolved = computed(() => this.catalog.resolveAll());
  readonly isEmpty = computed(() => this.resolved().length === 0);

  /** Active category filter; null = all categories. */
  readonly activeCategory = signal<ProductCategory | null>(null);
  /** Free-text query (matched against name, sku, tags). */
  readonly search = signal('');
  readonly onlyFavorites = signal(false);

  readonly fav = this.favorites;

  readonly categories: ProductCategory[] = [
    'slide',
    'swing',
    'climbing',
    'merry-go-round',
    'seesaw',
    'sandbox',
    'playhouse',
    'combo',
    'accessory',
  ];

  readonly filtered = computed(() => {
    const q = this.search().toLowerCase().trim();
    const cat = this.activeCategory();
    const favOnly = this.onlyFavorites();
    const favIds = this.favorites.ids();
    return this.resolved().filter((p) => {
      if (cat && p.category !== cat) return false;
      if (favOnly && !favIds.has(p.variantId)) return false;
      if (!q) return true;
      const haystack =
        `${p.name} ${p.sku} ${p.tags.join(' ')} ${p.size ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  });

  readonly familyCounts = computed(() => {
    const map = new Map<string, number>();
    for (const p of this.resolved()) {
      map.set(p.familyId, (map.get(p.familyId) ?? 0) + 1);
    }
    return map;
  });

  setCategory(cat: ProductCategory | null): void {
    this.activeCategory.set(cat);
  }

  onSearchInput(event: Event): void {
    const v = (event.target as HTMLInputElement).value;
    this.search.set(v);
  }

  toggleFavoritesOnly(): void {
    this.onlyFavorites.update((v) => !v);
  }

  async toggleFavorite(variantId: string, event: Event): Promise<void> {
    event.stopPropagation();
    event.preventDefault();
    const nowFav = await this.favorites.toggle(variantId);
    this.toast.success(nowFav ? 'toast.favoriteAdded' : 'toast.favoriteRemoved');
  }

  primaryImage(urls: { url: string; isPrimary: boolean }[]): string {
    return getPrimaryImageUrl(urls);
  }

  configure(variantId: string): void {
    this.configurator.loadFromVariant(variantId);
    void this.router.navigate(['/configurator']);
  }

  addToInvoice(variantId: string): void {
    const resolved = this.catalog.resolve(variantId);
    if (!resolved) return;
    const line = lineFromResolved(resolved, 1);
    void this.invoice.addLine(line);
    this.toast.success('toast.addedToInvoice');
  }

  variantCount(familyId: string): number {
    return this.familyCounts().get(familyId) ?? 0;
  }

  goToManagement(): void {
    void this.router.navigate(['/catalog-management']);
  }
}
