/**
 * Receipt layout domain model.
 *
 * A receipt is an ordered list of `LayoutElement`s. Each element has a
 * `type`, visibility flag, optional content (for text/image), and optional
 * style overrides. The layout is fully user-editable: drag-drop reorder,
 * add/remove elements, edit content + styles, and persist.
 *
 * Fixed element ids (`header`, `meta`, `table`, `visuals`) are part of the
 * default layout and are treated specially by the renderer — they pull
 * their content from the active invoice (seller block, line items, images,
 * totals). User-added elements (`text`, `image`, `divider`) carry their
 * own content.
 */

export type LayoutElementType =
  | 'header'
  | 'table'
  | 'meta'
  | 'visuals'
  | 'totals'
  | 'text'
  | 'image'
  | 'divider';

export interface LayoutElement {
  /** Stable id; fixed ids ('header', 'table', 'meta', 'visuals') are reserved. */
  id: string;
  type: LayoutElementType;
  visible: boolean;
  /** Optional i18n label key (e.g. 'receipt.elements.header') for display. */
  labelKey?: string;
  /** For text/image — the content (multi-line text or newline-separated URLs). */
  content?: string;
  /** Style overrides applied by the renderer. */
  styles?: ReceiptStyles;
  /** True for the default fixed elements that can't be removed. */
  fixed?: boolean;
}

export interface ReceiptStyles {
  // Text styles
  textAlign?: 'left' | 'center' | 'right';
  fontSize?: string; // e.g. "14px"
  fontWeight?: '400' | '600' | '700';
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline';
  color?: string; // hex
  lineHeight?: string; // e.g. "1.4"
  // Image styles
  imageFit?: 'contain' | 'cover';
  imageAlign?: 'left' | 'center' | 'right';
  imageWidth?: string; // e.g. "100%" or "200px"
  imageHeight?: string; // e.g. "180px"
  imageRadius?: string; // e.g. "0px"
  imagePerRow?: string; // e.g. "3"
}

export interface TaxLine {
  id: string;
  name: string;
  type: 'percent' | 'fixed';
  value: number;
  enabled: boolean;
}

/** Default text styles applied to new text elements. */
export const DEFAULT_TEXT_STYLES: ReceiptStyles = {
  textAlign: 'left',
  fontSize: '14px',
  fontWeight: '400',
  fontStyle: 'normal',
  textDecoration: 'none',
  color: '#111827',
  lineHeight: '1.4',
};

export const DEFAULT_HEADER_STYLES: ReceiptStyles = {
  textAlign: 'left',
  fontSize: '20px',
  fontWeight: '600',
  fontStyle: 'normal',
  textDecoration: 'none',
  color: '#111827',
  lineHeight: '1.3',
};

export const DEFAULT_IMAGE_STYLES: ReceiptStyles = {
  imageFit: 'contain',
  imageAlign: 'center',
  imageWidth: 'auto',
  imageHeight: '200px',
  imageRadius: '0px',
  imagePerRow: '3',
};

/**
 * Default layout — header, meta, items table, terms text, visuals gallery.
 * Matches the legacy layout the user expects, rebuilt on the new model.
 *
 * `content` keys for fixed elements are i18n keys resolved at render time;
 * user-added elements store raw content directly.
 */
export function buildDefaultLayout(_translateHeaderKey: string, _translateTermsKey: string): LayoutElement[] {
  return [
    {
      id: 'header',
      type: 'header',
      visible: true,
      fixed: true,
      labelKey: 'receipt.elements.header',
      content: '', // resolved from translation at render time if empty
      styles: { ...DEFAULT_HEADER_STYLES },
    },
    {
      id: 'meta',
      type: 'meta',
      visible: true,
      fixed: true,
      labelKey: 'receipt.elements.meta',
    },
    {
      id: 'table',
      type: 'table',
      visible: true,
      fixed: true,
      labelKey: 'receipt.elements.table',
    },
    {
      id: 'totals',
      type: 'totals',
      visible: true,
      fixed: true,
      labelKey: 'receipt.elements.totals',
    },
    {
      id: 'terms',
      type: 'text',
      visible: true,
      fixed: true,
      labelKey: 'receipt.elements.text',
      content: '', // resolved from translation at render time
      styles: { ...DEFAULT_TEXT_STYLES },
    },
    {
      id: 'visuals',
      type: 'visuals',
      visible: true,
      fixed: true,
      labelKey: 'receipt.elements.visuals',
    },
  ];
}
