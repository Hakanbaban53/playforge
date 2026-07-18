import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRouteSnapshot, RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

/**
 * Translatable page-title strategy.
 *
 * Routes store an i18n key in `data.titleKey` (e.g. `'nav.catalog'`).
 * This strategy translates the key and appends ` · ${appName}` to
 * produce the browser tab title. When the user switches languages,
 * the title re-translates automatically via `onLangChange`.
 *
 * Previously every route had a hardcoded English `title:` string, so
 * switching to Turkish left the tab title in English.
 */
@Injectable({ providedIn: 'root' })
export class TranslatableTitleStrategy extends TitleStrategy {
  private readonly titleService = inject(Title);
  private readonly translate = inject(TranslateService);

  private lastSnapshot: RouterStateSnapshot | null = null;

  constructor() {
    super();
    this.translate.onLangChange.subscribe(() => {
      if (this.lastSnapshot) {
        this.updateTitle(this.lastSnapshot);
      }
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.lastSnapshot = snapshot;
    const titleKey = this.readTitleKey(snapshot);
    const appName = this.translate.instant('app.name') as string;

    if (titleKey) {
      const translated = this.translate.instant(titleKey) as string;
      if (translated && translated !== titleKey) {
        this.titleService.setTitle(`${translated} · ${appName}`);
        return;
      }
    }

    // Fall back to static route title or app name only.
    const staticTitle = this.buildTitle(snapshot);
    if (staticTitle) {
      this.titleService.setTitle(staticTitle);
    } else {
      this.titleService.setTitle(appName);
    }
  }

  /** Walk the route tree to find the first `data.titleKey`. */
  private readTitleKey(snapshot: RouterStateSnapshot): string | undefined {
    let route: ActivatedRouteSnapshot | null = snapshot.root;
    while (route) {
      const key = route.data?.titleKey as string | undefined;
      if (key) return key;
      route = route.firstChild;
    }
    return undefined;
  }
}
