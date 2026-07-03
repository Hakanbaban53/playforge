import { Injectable, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { StorageService } from './storage.service';

export type AppLanguage = 'en' | 'tr';

const AVAILABLE_LANGS: AppLanguage[] = ['en', 'tr'];
const STORAGE_KEY = 'app:language';

/**
 * I18n facade — wraps `@ngx-translate/core`'s `TranslateService`.
 *
 * The active language is persisted in localStorage and re-applied on app
 * boot. Falls back to English if no preference is stored.
 *
 * **Initial load optimization:** The `init()` method is called from an
 * `APP_INITIALIZER` provider (see `app.config.ts`) so that translations
 * are loaded BEFORE the UI renders. This prevents the "5-10 seconds of
 * raw translation keys" flash on first paint.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly translate = inject(TranslateService);
  private readonly storage = inject(StorageService);

  readonly languages = AVAILABLE_LANGS;
  readonly lang = signal<AppLanguage>('en');

  constructor() {
    // Register languages and set defaults synchronously.
    this.translate.addLangs(AVAILABLE_LANGS);
    this.translate.setDefaultLang('en');
  }

  /**
   * Called from APP_INITIALIZER — loads translations BEFORE the UI renders.
   * Returns a Promise so the initializer can wait for it.
   */
  async init(): Promise<void> {
    const stored = this.storage.read<AppLanguage | null>(STORAGE_KEY, null);
    const initial: AppLanguage =
      stored && AVAILABLE_LANGS.includes(stored)
        ? stored
        : this.detectBrowserLang();
    // `use()` returns an Observable that completes when the JSON loads.
    await this.translate.use(initial).toPromise();
    this.lang.set(initial);
  }

  /** Switch the active language. */
  use(lang: AppLanguage): void {
    this.translate.use(lang);
    this.lang.set(lang);
    this.storage.write(STORAGE_KEY, lang);
  }

  /** Sync translation of a key — for use outside templates. */
  t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }

  /** Async translation — loads the lang file first if needed. */
  async get(key: string, params?: Record<string, unknown>): Promise<string> {
    return this.translate.get(key, params).toPromise();
  }

  private detectBrowserLang(): AppLanguage {
    if (typeof navigator === 'undefined') return 'en';
    const nav = navigator.language?.toLowerCase() ?? 'en';
    if (nav.startsWith('tr')) return 'tr';
    return 'en';
  }
}
