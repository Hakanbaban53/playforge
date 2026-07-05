import { Component, input, inject, signal, effect, ChangeDetectionStrategy } from '@angular/core';
import { NgStyle } from '@angular/common';
import { ImageResolverService } from '../../core/services/image-resolver.service';

/**
 * Renders an <img> whose src is resolved from an idb:// (or other)
 * reference via ImageResolverService. Resolves asynchronously and updates
 * the rendered src once the blob URL is ready.
 *
 * Why a component instead of a pipe? Pure pipes can't re-run after async
 * resolution under zoneless CD. A component with a signal-backed src
 * re-renders when the signal updates.
 *
 * Pass a styles record to apply CSS properties to the inner <img>.
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

  /** Source URL reference — `idb://...`, `http(s)://...`, `data:...`, `blob:...`. */
  readonly src = input<string | undefined | null>(undefined);
  readonly alt = input<string>('');
  readonly imgClass = input<string>('');
  /** CSS style object applied directly to the inner `<img>` via ngStyle. */
  readonly styles = input<Record<string, string>>({});

  /** Resolved URL — empty string until async resolution completes. */
  readonly resolvedSrc = signal<string>('');

  constructor() {
    effect(() => {
      const url = this.src();
      if (!url) {
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
      this.resolver.resolve(url).then(
        (resolved) => this.resolvedSrc.set(resolved),
        (err) => console.warn('[ResolvedImg] failed to resolve', url, err),
      );
    });
  }
}
