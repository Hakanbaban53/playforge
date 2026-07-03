/**
 * Core domain model for the PlayForge catalog.
 *
 * Design goals
 * ------------
 * 1. **Part-based composition** — A playground product (e.g. a slide) is
 *    modelled as an assembly of `Part`s. Each `Part` carries its own price,
 *    so the configurator can sum parts live and reverse-match a parts
 *    combination to a known catalog product.
 *
 * 2. **Family + Variant inheritance** — Products that differ in only one or
 *    two attributes (size, color, price) share a `ProductFamily` parent and
 *    only override what changes. This avoids duplicating full records and
 *    keeps the catalog DRY. See `ResolvedProduct` for the merge contract.
 *
 * 3. **Image references** — Image rows store a URL or asset path; the
 *    renderer resolves them safely (the legacy app had broken image handling
 *    because it relied on a Tauri-only `convertFileSrc`). Here images are
 *    plain URLs/data-URIs so they render identically in browser & PDF.
 */

/** A single image attached to a product or part. */
export interface ProductImage {
  /** Stable id (uuid-style); used for reordering / tracking. */
  id: string;
  /** URL, asset path, or `data:` URI. Must be browser-renderable. */
  url: string;
  /** Optional caption for accessibility / invoice display. */
  alt?: string;
  /** Whether this is the marketing/hero image. */
  isPrimary: boolean;
}

/**
 * A discrete, sellable component of a playground product.
 *
 * Examples: "Slide chute (3m)", "Climbing wall panel", "Roof canopy".
 * A part has its own SKU and price so the configurator can total them up.
 */
export interface Part {
  id: string;
  /** Human label shown in the configurator, e.g. "Slide chute 3m". */
  name: string;
  /** Stock keeping unit — must be unique within a family. */
  sku: string;
  /** Category used to group parts in the configurator UI. */
  category: PartCategory;
  /** Unit price in the family's currency. */
  price: number;
  /** Optional description / spec line. */
  description?: string;
  /** Optional images. */
  images?: ProductImage[];
  /**
   * `true` when this part is required for any assembly (e.g. the slide
   * chassis). The configurator will preselect required parts.
   */
  required?: boolean;
}

export type PartCategory =
  | 'structure'
  | 'slide'
  | 'climb'
  | 'swing'
  | 'roof'
  | 'safety'
  | 'decoration'
  | 'foundation';

/**
 * The shared parent of one or more variants.
 *
 * Everything common to a product line (name, category, default parts,
 * images, currency, description, age range) lives here. Variants only
 * override the attributes that actually differ — typically size and price.
 */
export interface ProductFamily {
  id: string;
  /** Display name e.g. "Cascade Slide Tower". */
  name: string;
  /** Marketing / SEO friendly code, e.g. "CSC-TWR". */
  code: string;
  /** High-level category for filtering the catalog. */
  category: ProductCategory;
  /** Marketing description (multi-line). */
  description: string;
  /** Age range label e.g. "3-8 yrs". */
  ageRange?: string;
  /** Default currency ISO code, e.g. "USD". */
  currency: string;
  /** Tags used for filtering: "outdoor", "inclusive", etc. */
  tags: string[];
  /** Gallery of marketing images. */
  images: ProductImage[];
  /**
   * The full set of parts that *could* be configured for this family.
   * Variants narrow this down by selecting a subset (see `ProductVariant.parts`).
   */
  availableParts: Part[];
  /** ISO timestamp (ms). */
  createdAt: number;
  updatedAt: number;
}

export type ProductCategory =
  | 'slide'
  | 'swing'
  | 'climbing'
  | 'merry-go-round'
  | 'seesaw'
  | 'sandbox'
  | 'playhouse'
  | 'combo'
  | 'accessory';

/**
 * Override-attribute union. Each entry says "set this attribute to this value".
 * Anything not listed is inherited from the family.
 *
 * Using a discriminated map keeps the data model honest: variants can only
 * override attributes the schema knows about, which prevents silent typos
 * like `{ sieze: '5m' }` slipping through.
 */
export type VariantOverride =
  | { key: 'size'; value: string }
  | { key: 'price'; value: number }
  | { key: 'currency'; value: string }
  | { key: 'ageRange'; value: string }
  | { key: 'description'; value: string }
  | { key: 'tags'; value: string[] }
  | { key: 'images'; value: ProductImage[] }
  | { key: 'parts'; value: string[] }; // part ids — replaces family default

/**
 * A specific sellable variant of a `ProductFamily`.
 *
 * Variants intentionally do NOT duplicate the family record. They declare
 * only the attributes that differ. The configurator resolves a variant into
 * a `ResolvedProduct` (see `catalog.service.ts`) before display/pricing.
 *
 * Example: family "Cascade Slide Tower" has variants "1m", "3m", "5m"
 * that override `size` and `price` only — everything else (name, parts,
 * images, currency) is inherited from the family.
 */
export interface ProductVariant {
  id: string;
  familyId: string;
  /** Display label for this variant, e.g. "5m". */
  label: string;
  /** Unique SKU for the variant, e.g. "CSC-TWR-5M". */
  sku: string;
  /** Whether this variant is currently orderable. */
  active: boolean;
  /**
   * Overrides applied on top of the family defaults. An empty array means
   * the variant is functionally identical to the family baseline (rare but
   * useful for "Standard" variants that exist purely for SKU tracking).
   */
  overrides: VariantOverride[];
  /** ISO timestamp (ms). */
  createdAt: number;
  updatedAt: number;
}

/**
 * The flattened, runtime view of a variant — family defaults merged with
 * variant overrides. This is what UI components and the invoice consume.
 */
export interface ResolvedProduct {
  variantId: string;
  familyId: string;
  name: string;
  code: string;
  sku: string;
  category: ProductCategory;
  description: string;
  ageRange?: string;
  currency: string;
  tags: string[];
  images: ProductImage[];
  /** Resolved part set (either family default or variant override). */
  parts: Part[];
  /** Final unit price (either variant override or family-derived baseline). */
  price: number;
  /** Optional explicit size label, present only if overridden. */
  size?: string;
}

/**
 * A part selection made by the user in the configurator.
 * Used as the configurator's working state and persisted into invoices.
 */
export interface ConfiguredPart {
  partId: string;
  quantity: number;
}

/**
 * The configurator's working document for one assembly.
 * Two of these are "equal" iff their family + selected part SKUs match —
 * that equality is what the reverse-match algorithm uses to suggest
 * catalog products (see `configurator.service.ts`).
 */
export interface ConfigurationDraft {
  familyId: string;
  selectedParts: ConfiguredPart[];
}

/** Discriminated result of the reverse-match algorithm. */
export type MatchSuggestion =
  | { kind: 'exact'; product: ResolvedProduct }
  | { kind: 'partial'; product: ResolvedProduct; missingSkus: string[]; extraSkus: string[] }
  | { kind: 'none' };
