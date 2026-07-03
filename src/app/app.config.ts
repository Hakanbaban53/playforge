import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  APP_INITIALIZER,
  inject,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideTranslateService, TranslateLoader } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { HttpClient } from '@angular/common/http';

import { routes } from './app.routes';
import { ThemeService } from './core/services/theme.service';
import { FileStorageAdapter } from './core/services/file-storage.adapter';
import { BrowserFileStorageAdapter } from './core/services/browser-file-storage.adapter';
import { TauriFileStorageAdapter } from './core/services/tauri-file-storage.adapter';
import { I18nService } from './core/services/i18n.service';

export function httpLoaderFactory(http: HttpClient): TranslateLoader {
  return new TranslateHttpLoader(http, 'assets/i18n/', '.json');
}

function isTauriEnvironment(): boolean {
  return typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';
}

/**
 * APP_INITIALIZER factory — loads translations BEFORE the UI renders.
 * This prevents the "raw translation keys flashing" on first paint.
 */
function initializeI18n(): () => Promise<void> {
  const i18n = inject(I18nService);
  return () => i18n.init();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(),
    provideTranslateService({
      loader: {
        provide: TranslateLoader,
        useFactory: httpLoaderFactory,
        deps: [HttpClient],
      },
    }),
    // Load translations before first paint — no more key flashing.
    {
      provide: APP_INITIALIZER,
      useFactory: initializeI18n,
      deps: [],
      multi: true,
    },
    {
      provide: FileStorageAdapter,
      useFactory: () => {
        if (isTauriEnvironment()) {
          return new TauriFileStorageAdapter();
        }
        return new BrowserFileStorageAdapter();
      },
    },
    {
      provide: 'INIT_THEME',
      useFactory: () => {
        const t = new ThemeService();
        t.applyInitial();
        return t;
      },
    },
  ],
};
