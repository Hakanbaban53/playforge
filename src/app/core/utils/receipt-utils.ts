import { LayoutElement, ReceiptStyles } from '../models/receipt.model';

export function getPrimaryImageUrl(images: { url: string; isPrimary: boolean }[]): string {
  const primary = images.find((i) => i.isPrimary) ?? images[0];
  return primary?.url ?? '';
}

export function computeTaxAmount(
  tax: { type: 'percent' | 'fixed'; value: number },
  subtotal: number,
): number {
  if (tax.type === 'fixed') return tax.value;
  return subtotal * (tax.value / 100);
}

export function computeTextStyles(el: LayoutElement): Record<string, string> {
  const s = el.styles ?? {};
  return {
    textAlign: s.textAlign ?? 'left',
    fontSize: s.fontSize ?? (el.type === 'header' ? '20px' : '14px'),
    fontWeight: s.fontWeight ?? (el.type === 'header' ? '600' : '400'),
    fontStyle: s.fontStyle ?? 'normal',
    textDecoration: s.textDecoration ?? 'none',
    color: s.color ?? '#111827',
    lineHeight: s.lineHeight ?? (el.type === 'header' ? '1.3' : '1.4'),
  };
}

export function computeImageStyles(el: LayoutElement): Record<string, string> {
  const s = el.styles ?? {};
  return {
    width: s.imageWidth ?? 'auto',
    maxWidth: '100%',
    maxHeight: s.imageHeight ?? '200px',
    objectFit: s.imageFit ?? 'contain',
    borderRadius: s.imageRadius ?? '0px',
    display: 'block',
  };
}

export function computeImageWrapperStyles(el: LayoutElement): Record<string, string> {
  const s = el.styles ?? {};
  const align = s.imageAlign ?? 'center';
  const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
  const perRow = s.imagePerRow ?? (el.type === 'visuals' ? '3' : '1');
  return {
    display: 'grid',
    gap: '8px',
    gridTemplateColumns: `repeat(${perRow}, 1fr)`,
    justifyItems: justify,
  };
}

export function parseImageSources(content: string | undefined): string[] {
  if (!content) return [];
  return content
    .split(/\r?\n|,|;/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function getStyleValue(
  el: LayoutElement,
  key: keyof ReceiptStyles,
  fallback: string,
): string {
  return el.styles?.[key] ?? fallback;
}
