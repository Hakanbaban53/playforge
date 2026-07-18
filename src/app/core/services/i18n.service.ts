import { Injectable, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { StorageService } from './storage.service';

export type AppLanguage = 'en' | 'tr';

const AVAILABLE_LANGS: AppLanguage[] = ['en', 'tr'];
const STORAGE_KEY = 'app:language';

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly translate = inject(TranslateService);
  private readonly storage = inject(StorageService);

  readonly languages = AVAILABLE_LANGS;
  readonly lang = signal<AppLanguage>('en');

  constructor() {
    this.translate.addLangs(AVAILABLE_LANGS);
    this.translate.setDefaultLang('en');
  }

  async init(): Promise<void> {
    const stored = this.storage.read<AppLanguage | null>(STORAGE_KEY, null);
    const initial: AppLanguage =
      stored && AVAILABLE_LANGS.includes(stored)
        ? stored
        : this.detectBrowserLang();
    await firstValueFrom(this.translate.use(initial));
    this.lang.set(initial);
    this.syncHtmlLang(initial);
    this.syncDocumentTitle();
  }

  use(lang: AppLanguage): void {
    void firstValueFrom(this.translate.use(lang)).then(() => {
      this.syncDocumentTitle();
    });
    this.lang.set(lang);
    this.storage.write(STORAGE_KEY, lang);
    this.syncHtmlLang(lang);
  }

  t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params) as string;
  }

  async get(key: string, params?: Record<string, unknown>): Promise<string> {
    return firstValueFrom(this.translate.get(key, params)) as Promise<string>;
  }

  locale(): string {
    return this.lang() === 'tr' ? 'tr-TR' : 'en-US';
  }

  private detectBrowserLang(): AppLanguage {
    if (typeof navigator === 'undefined') return 'en';
    const nav = navigator.language?.toLowerCase() ?? 'en';
    return nav.startsWith('tr') ? 'tr' : 'en';
  }

  private syncHtmlLang(lang: AppLanguage): void {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
    }
  }

  /**
   * Keep the browser tab title in sync with the active language. The title
   * text itself is just a translated string (`app.title`), so switching to
   * Turkish updates both `<html lang>` and `document.title` together —
   * previously the title stayed English even after switching languages
   * because index.html hard-coded `<title>PlayForge</title>`.
   */
  private syncDocumentTitle(): void {
    if (typeof document === 'undefined') return;
    const title = this.translate.instant('app.title') as string;
    if (title && title !== 'app.title') {
      document.title = title;
    }
  }
}
