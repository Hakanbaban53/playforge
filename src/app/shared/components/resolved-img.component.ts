import { Component, input, inject, signal, effect, ChangeDetectionStrategy } from '@angular/core';
import { NgStyle } from '@angular/common';
import { ImageResolverService } from '../../core/services/image-resolver.service';

/**
 * Renders an `<img>` whose `src` is resolved from an `idb://` (or other)
 * reference via `ImageResolverService`. Resolves asynchronously and updates
 * the rendered `src` once the blob URL is ready.
 *
 * Why a component instead of a pipe?
 *   - The previous `resolveImage` pipe was `pure: false` and relied on zone-
 *     based CD to re-run after async resolution. Under zoneless Angular, the
 *     pipe would return an empty string and never re-run.
 *   - A component with a signal-backed `src` updates correctly under
 *     zoneless CD: when the signal changes, the component's view re-renders.
 *
 * Styling: pass a `styles` record to apply arbitrary CSS properties to the
 * inner `<img>`. This is how the receipt editor applies per-element image
 * sizing (width, height, object-fit, border-radius, etc.) — the styles go
 * directly on the `<img>`, not on the host element.
 *
 * Usage:
 *   <app-resolved-img [src]="imageUrl" [alt]="name" [styles]="{ width: '100%' }" />
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
    // Whenever the input src changes, kick off resolution and update the
    // signal when done. The signal update triggers zoneless CD.
    effect(async () => {
      const url = this.src();
      if (!url) {
        this.resolvedSrc.set('');
        return;
      }
      // Fast path: not an idb:// reference, or already cached.
      const cached = this.resolver.getCached(url);
      if (cached) {
        this.resolvedSrc.set(cached);
        return;
      }
      if (!this.resolver.isStoredRef(url)) {
        this.resolvedSrc.set(url);
        return;
      }
      // Async resolution — update the signal when done.
      this.resolvedSrc.set('');
      try {
        const resolved = await this.resolver.resolve(url);
        this.resolvedSrc.set(resolved);
      } catch (err) {
        console.warn('[ResolvedImg] failed to resolve', url, err);
      }
    });
  }
}
