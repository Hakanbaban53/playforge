import { Pipe, PipeTransform } from '@angular/core';

/**
 * Format a number as a currency string.
 *
 * Pure pipe (default) — recomputes only when its inputs change. Safe under
 * zoneless change detection because it has no side effects.
 *
 * Usage:
 *   {{ amount | currency:'USD' }}
 *   {{ amount | currency:'TRY':'tr-TR' }}
 */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(
    value: number | null | undefined,
    currency = 'USD',
    locale = 'en-US',
  ): string {
    if (value == null || !Number.isFinite(value)) value = 0;
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      // Fallback for unknown currency codes.
      return `${currency} ${value.toFixed(2)}`;
    }
  }
}
