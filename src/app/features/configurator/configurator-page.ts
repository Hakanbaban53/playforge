import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { CatalogService } from '../../core/services/catalog.service';
import { ConfiguratorService } from '../../core/services/configurator.service';
import { InvoiceService } from '../../core/services/invoice.service';
import { ToastService } from '../../core/services/toast.service';
import { lineFromConfiguration } from '../../core/models/invoice.model';
import { IconComponent } from '../../shared/components/icon.component';
import { ButtonComponent } from '../../shared/components/button.component';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { ResolvedImgComponent } from '../../shared/components/resolved-img.component';
import { getPrimaryImageUrl } from '../../core/utils/receipt-utils';
import { PartCategory } from "../../core/models/catalog.model";

/**
 * Part-based product configurator.
 *
 * Left column: family picker + grouped parts checklist.
 * Right column: live preview — running total, selected parts, and the
 * reverse-match suggestion card ("Did you mean to configure [Product X]?").
 *
 * The reverse-match card appears whenever the user's parts combination
 * matches (or nearly matches) a known catalog variant. Exact matches turn
 * the card green; partial matches turn it amber and list the missing/extra
 * SKUs. Clicking "Use suggested" loads that variant's exact configuration.
 */
@Component({
  selector: 'app-configurator-page',
  standalone: true,
  imports: [
    IconComponent,
    ButtonComponent,
    MoneyPipe,
    TranslatePipe,
    ResolvedImgComponent,
  ],
  templateUrl: './configurator-page.html',
  styleUrl: './configurator-page.scss',
})
export class ConfiguratorPage {
  private readonly catalog = inject(CatalogService);
  private readonly configurator = inject(ConfiguratorService);
  private readonly invoice = inject(InvoiceService);
  private readonly toast = inject(ToastService);

  readonly families = this.catalog.families;
  readonly family = this.configurator.family;
  readonly availableParts = this.configurator.availableParts;
  readonly selectedPartsResolved = this.configurator.selectedPartsResolved;
  readonly totalPrice = this.configurator.totalPrice;
  readonly requiredSatisfied = this.configurator.requiredSatisfied;
  readonly matchSuggestion = this.configurator.matchSuggestion;
  readonly selection = this.configurator.selection;

  /**
   * Type-narrowed views of `matchSuggestion` for the template. The Angular
   * template type-checker doesn't narrow `matchSuggestion()` calls across
   * `@switch` cases, so we expose one computed per branch and let the
   * template use `@if (x; as v)` for narrowing.
   */
  readonly exactMatch = computed(() => {
    const s = this.matchSuggestion();
    return s.kind === 'exact' ? s : null;
  });
  readonly partialMatch = computed(() => {
    const s = this.matchSuggestion();
    return s.kind === 'partial' ? s : null;
  });

  readonly partCategories: PartCategory[] = [
    'structure', 'slide', 'climb', 'swing', 'roof', 'safety', 'decoration', 'foundation',
  ];

  /** Parts grouped by category for the UI. */
  readonly partsByCategory = computed(() => {
    const parts = this.availableParts();
    const map = new Map<PartCategory, typeof parts>();
    for (const p of parts) {
      const list = map.get(p.category) ?? [];
      list.push(p);
      map.set(p.category, list);
    }
    return Array.from(map.entries());
  });

  /** Has the user picked at least one optional part? */
  readonly hasSelection = computed(() => this.selectedPartsResolved().length > 0);

  selectFamily(familyId: string): void {
    this.configurator.setFamily(familyId);
  }

  isPartSelected(partId: string): boolean {
    return (this.selection().get(partId) ?? 0) > 0;
  }

  toggle(partId: string): void {
    this.configurator.togglePart(partId);
  }

  increment(partId: string): void {
    const current = this.selection().get(partId) ?? 0;
    this.configurator.setQuantity(partId, current + 1);
  }

  decrement(partId: string): void {
    const current = this.selection().get(partId) ?? 0;
    this.configurator.setQuantity(partId, current - 1);
  }

  setQuantity(partId: string, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.configurator.setQuantity(partId, value);
  }

  clearOptional(): void {
    this.configurator.clearOptional();
  }

  resetAll(): void {
    this.configurator.resetSelection();
  }

  /** Apply the suggested variant's exact parts list. */
  useSuggestion(): void {
    const suggestion = this.matchSuggestion();
    if (suggestion.kind === 'none') return;
    this.configurator.loadFromVariant(suggestion.product.variantId);
  }

  /** Push the current configuration onto the active invoice. */
  addToInvoice(): void {
    const family = this.family();
    if (!family) return;
    const parts = this.selectedPartsResolved().map(({ part, quantity }) => ({
      partId: part.id,
      name: part.name,
      sku: part.sku,
      unitPrice: part.price,
      quantity,
    }));
    if (parts.length === 0) return;

    const primaryImage = family.images.find((i) => i.isPrimary) ?? family.images[0];
    const line = lineFromConfiguration(
      family.name,
      `${family.code}-CUSTOM`,
      family.id,
      parts,
      primaryImage?.url,
      undefined,
    );
    void this.invoice.addLine(line);
    this.toast.success('toast.addedToInvoice');
  }

  primaryImage(urls: { url: string; isPrimary: boolean }[]): string {
    return getPrimaryImageUrl(urls);
  }
}
