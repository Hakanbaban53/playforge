import { Component, input, computed, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ICON_PATHS } from './icon-registry';

/**
 * Material Symbols icon component — uses self-hosted SVG icons (no CDN,
 * no font file). Works fully offline in Tauri.
 *
 * Usage:
 *   <app-icon name="shopping_cart" />
 *   <app-icon name="check" [size]="20" />
 *
 * To add a new icon, add its SVG to `icon-registry.ts`.
 */
@Component({
  selector: 'app-icon',
  standalone: true,
  template: `
    <span
      class="app-icon"
      [style.width.px]="size()"
      [style.height.px]="size()"
      [innerHTML]="svgContent()"
    ></span>
  `,
  styles: [`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 0;
    }
    .app-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .app-icon svg {
      width: 100%;
      height: 100%;
    }
  `],
})
export class IconComponent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly name = input.required<string>();
  readonly size = input<number>(20);

  readonly svgContent = computed<SafeHtml>(() => {
    const svg = ICON_PATHS[this.name()];
    return this.sanitizer.bypassSecurityTrustHtml(svg ?? ICON_PATHS['help']);
  });
}
