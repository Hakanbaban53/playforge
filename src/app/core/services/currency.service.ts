import { Injectable, inject, signal } from '@angular/core';
import { StorageService } from './storage.service';

export type CurrencyCode = 'USD' | 'TRY' | 'EUR';

interface RateMap {
  USD: number; // always 1
  TRY: number;
  EUR: number;
}

const STORAGE_KEY = 'app:exchange-rates';
const BASE_CURRENCY_KEY = 'app:base-currency';

const DEFAULT_RATES: RateMap = {
  USD: 1,
  TRY: 32.5,
  EUR: 0.92,
};

/**
 * Currency + exchange-rate service.
 *
 * The model: prices are stored in the catalog in their family-declared
 * currency (e.g. USD). The `baseCurrency` is the user's home currency.
 * When the UI displays a price in a different currency than the source,
 * `convert()` first converts source → USD (1/sourceRate), then USD →
 * target (targetRate).
 *
 * Exchange rates are user-configurable in Settings. There is no live API
 * call — the user keeps them up to date manually. This is deliberate: an
 * enterprise POS shouldn't depend on a third-party rate API being online
 * at quote time.
 */
@Injectable({ providedIn: 'root' })
export class CurrencyService {
  private readonly storage = inject(StorageService);

  private readonly _rates = signal<RateMap>(
    this.storage.read<RateMap>(STORAGE_KEY, DEFAULT_RATES),
  );
  private readonly _base = signal<CurrencyCode>(
    this.storage.read<CurrencyCode>(BASE_CURRENCY_KEY, 'USD'),
  );

  readonly rates = this._rates.asReadonly();
  readonly base = this._base.asReadonly();

  readonly supportedCurrencies: CurrencyCode[] = ['USD', 'TRY', 'EUR'];

  /** Update the exchange rate for a target currency (1 USD = X target). */
  setRate(code: CurrencyCode, rate: number): void {
    if (code === 'USD') return; // USD is the immutable base (always 1)
    const clamped = Math.max(0, Number.isFinite(rate) ? rate : 0);
    this._rates.update((r) => {
      const next = { ...r, [code]: clamped };
      this.storage.write(STORAGE_KEY, next);
      return next;
    });
  }

  setBase(code: CurrencyCode): void {
    this._base.set(code);
    this.storage.write(BASE_CURRENCY_KEY, code);
  }

  /**
   * Convert an amount from one currency to another using stored rates.
   * Both source and target must be in `supportedCurrencies`.
   */
  convert(amount: number, from: CurrencyCode, to: CurrencyCode): number {
    if (from === to) return amount;
    const rates = this._rates();
    const fromRate = rates[from];
    const toRate = rates[to];
    if (!fromRate || !toRate) return amount;
    // source → USD → target
    return (amount / fromRate) * toRate;
  }

  /** Format an amount in a target currency, with locale-aware grouping. */
  format(amount: number, code: CurrencyCode, locale = 'en-US'): string {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: code,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${code} ${amount.toFixed(2)}`;
    }
  }

  convertAndFormat(
    amount: number,
    from: CurrencyCode,
    to: CurrencyCode,
    locale = 'en-US',
  ): string {
    return this.format(this.convert(amount, from, to), to, locale);
  }
}
