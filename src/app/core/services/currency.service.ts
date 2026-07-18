import { Injectable, inject, computed } from '@angular/core';
import { DataProvider, Collections } from './data-provider';

export type CurrencyCode = 'USD' | 'TRY' | 'EUR';

interface RateMap {
  USD: number; // always 1
  TRY: number;
  EUR: number;
}

interface CurrencyDoc {
  rates: RateMap;
  base: CurrencyCode;
}

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
 *
 * Storage: a single doc under `app:exchange-rates` with shape
 * `{ rates, base }`. Syncs to Firestore when signed in.
 */
@Injectable({ providedIn: 'root' })
export class CurrencyService {
  private readonly data = inject(DataProvider);

  private readonly docSignal = this.data.doc<CurrencyDoc>(Collections.currencyRates);

  readonly rates = computed<RateMap>(() => this.docSignal()?.rates ?? DEFAULT_RATES);
  readonly base = computed<CurrencyCode>(() => this.docSignal()?.base ?? 'USD');

  readonly supportedCurrencies: CurrencyCode[] = ['USD', 'TRY', 'EUR'];

  /** Update the exchange rate for a target currency (1 USD = X target). */
  async setRate(code: CurrencyCode, rate: number): Promise<void> {
    if (code === 'USD') return; // USD is the immutable base (always 1)
    const clamped = Math.max(0, Number.isFinite(rate) ? rate : 0);
    const current = this.docSignal();
    const next: CurrencyDoc = {
      rates: { ...(current?.rates ?? DEFAULT_RATES), [code]: clamped },
      base: current?.base ?? 'USD',
    };
    await this.data.setDoc(Collections.currencyRates, next);
  }

  async setBase(code: CurrencyCode): Promise<void> {
    const current = this.docSignal();
    const next: CurrencyDoc = {
      rates: current?.rates ?? DEFAULT_RATES,
      base: code,
    };
    await this.data.setDoc(Collections.currencyRates, next);
  }

  /**
   * Convert an amount from one currency to another using stored rates.
   * Both source and target must be in `supportedCurrencies`.
   */
  convert(amount: number, from: CurrencyCode, to: CurrencyCode): number {
    if (from === to) return amount;
    const rates = this.rates();
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
