import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  provideAppInitializer,
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
    provideAppInitializer(() => inject(I18nService).init()),
    provideAppInitializer(() => { inject(ThemeService); }),
    {
      provide: FileStorageAdapter,
      useFactory: () => {
        if (isTauriEnvironment()) {
          return new TauriFileStorageAdapter();
        }
        return new BrowserFileStorageAdapter();
      },
    },
  ],
};
