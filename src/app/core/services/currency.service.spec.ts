import { TestBed } from '@angular/core/testing';
import { CurrencyService, CurrencyCode } from './currency.service';

/**
 * CurrencyService tests — covers rate configuration, conversion math, and
 * formatting.
 */
describe('CurrencyService', () => {
  let service: CurrencyService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(CurrencyService);
  });

  it('exposes the three supported currencies', () => {
    expect(service.supportedCurrencies).toEqual(['USD', 'TRY', 'EUR']);
  });

  it('USD rate is always 1 and cannot be changed', () => {
    service.setRate('USD', 999);
    expect(service.rates().USD).toBe(1);
  });

  it('setRate() updates and persists the rate', () => {
    service.setRate('TRY', 35.5);
    expect(service.rates().TRY).toBe(35.5);
    const stored = JSON.parse(localStorage.getItem('pgpos:app:exchange-rates')!);
    expect(stored.TRY).toBe(35.5);
  });

  it('setRate() rejects negative numbers', () => {
    service.setRate('TRY', -10);
    expect(service.rates().TRY).toBe(0);
  });

  it('setRate() rejects NaN', () => {
    service.setRate('TRY', NaN);
    expect(service.rates().TRY).toBe(0);
  });

  it('convert() returns the same amount for same currency', () => {
    expect(service.convert(100, 'USD', 'USD')).toBe(100);
    expect(service.convert(100, 'TRY', 'TRY')).toBe(100);
  });

  it('convert() USD → TRY uses the stored rate', () => {
    service.setRate('TRY', 32);
    expect(service.convert(100, 'USD', 'TRY')).toBeCloseTo(3200, 2);
  });

  it('convert() TRY → USD inverts the rate', () => {
    service.setRate('TRY', 32);
    expect(service.convert(3200, 'TRY', 'USD')).toBeCloseTo(100, 2);
  });

  it('convert() crosses through USD when source ≠ target ≠ USD', () => {
    // 1 USD = 32 TRY, 1 USD = 0.92 EUR
    // 100 TRY → USD = 100/32 = 3.125 USD → EUR = 3.125 * 0.92 = 2.875
    service.setRate('TRY', 32);
    service.setRate('EUR', 0.92);
    expect(service.convert(100, 'TRY', 'EUR')).toBeCloseTo(2.875, 2);
  });

  it('format() produces a locale-aware currency string', () => {
    const s = service.format(1234.5, 'USD', 'en-US');
    expect(s).toContain('1,234.50');
    expect(s).toContain('$');
  });

  it('format() falls back for unknown currencies', () => {
    const s = service.format(100, 'XYZ' as CurrencyCode);
    expect(s).toContain('100.00');
  });

  it('setBase() updates and persists the base currency', () => {
    service.setBase('TRY');
    expect(service.base()).toBe('TRY');
    // StorageService JSON-encodes values, so the stored form is '"TRY"'.
    expect(localStorage.getItem('pgpos:app:base-currency')).toBe('"TRY"');
  });

  it('convertAndFormat() combines conversion and formatting', () => {
    service.setRate('TRY', 32);
    const s = service.convertAndFormat(100, 'USD', 'TRY', 'en-US');
    // 100 USD * 32 = 3200 TRY
    expect(s).toContain('3,200');
  });
});
