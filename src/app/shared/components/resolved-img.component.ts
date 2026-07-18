import { Component, input, inject, signal, effect, ChangeDetectionStrategy, DestroyRef } from '@angular/core';
import { NgStyle } from '@angular/common';
import { ImageResolverService } from '../../core/services/image-resolver.service';
import { AuthService } from '../../core/services/auth.service';

/**
 * Renders an <img> whose src is resolved from an `idb://` or
 * `fbstorage://` reference via `ImageResolverService`. Resolves
 * asynchronously and updates the rendered src once the URL is ready.
 *
 * Lifecycle safety:
 *   - The async `resolve()` call is tracked per `src` change. If the
 *     component is destroyed before resolution completes (route change,
 *     logout, etc.), the result is dropped — we check `destroyed` before
 *     writing to `resolvedSrc`.
 *   - If a new `src` arrives while an old resolution is still in flight,
 *     the old result is dropped (we track the latest `src` value and
 *     only apply results matching it).
 *   - `fbstorage://` refs are NOT resolved when the user is
 *     unauthenticated — `ImageResolverService.resolve()` returns ''
 *     immediately in that case, avoiding a doomed 403 from Storage.
 */
@Component({
  selector: 'app-resolved-img',
  standalone: true,
  imports: [NgStyle],
  template: `
    <img
      [src]="resolvedSrc()"
      [alt]="alt()"
      [class]="imgClass()"
      [ngStyle]="styles()"
      [attr.referrerpolicy]="'no-referrer'"
      [attr.loading]="'lazy'"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResolvedImgComponent {
  private readonly resolver = inject(ImageResolverService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  readonly src = input<string | undefined | null>(undefined);
  readonly alt = input<string>('');
  readonly imgClass = input<string>('');
  readonly styles = input<Record<string, string>>({});

  readonly resolvedSrc = signal<string>('');

  private destroyed = false;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
    });

    effect(() => {
      const url = this.src();
      const authed = this.auth.isAuthenticated();

      if (!url) {
        this.resolvedSrc.set('');
        return;
      }

      if (!authed && url.startsWith('fbstorage://')) {
        this.resolvedSrc.set('');
        return;
      }

      const cached = this.resolver.getCached(url);
      if (cached) {
        this.resolvedSrc.set(cached);
        return;
      }
      if (!this.resolver.isStoredRef(url)) {
        this.resolvedSrc.set(url);
        return;
      }
      this.resolvedSrc.set('');

      const targetUrl = url;
      this.resolver
        .resolve(url)
        .then((resolved) => {
          if (this.destroyed) return;
          if (this.src() !== targetUrl) return;
          this.resolvedSrc.set(resolved);
        })
        .catch((err) => {
          if (this.destroyed) return;
          const code = (err as { code?: string }).code ?? '';
          if (code === 'storage/unauthorized' || code === 'storage/object-not-found') return;
          console.warn('[ResolvedImg] failed to resolve', url, err);
        });
    });
  }
}
