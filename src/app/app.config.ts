import { ApplicationConfig, importProvidersFrom } from "@angular/core";
import { HttpClient, provideHttpClient } from "@angular/common/http";
import { TranslateModule, TranslateLoader } from "@ngx-translate/core";
import { TranslateHttpLoader, TRANSLATE_HTTP_LOADER_CONFIG } from "@ngx-translate/http-loader";

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(),
    {
      provide: TRANSLATE_HTTP_LOADER_CONFIG,
      useValue: { prefix: './assets/i18n/', suffix: '.json' }
    },
    importProvidersFrom(
      TranslateModule.forRoot({
        loader: {
          provide: TranslateLoader,
          useClass: TranslateHttpLoader
        },
        useDefaultLang: true
      })
    )
  ],
};
