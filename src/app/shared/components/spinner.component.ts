import { Component, input } from '@angular/core';

@Component({
  selector: 'app-spinner',
  standalone: true,
  template: `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 50 50"
      class="app-spinner"
      aria-hidden="true"
    >
      <style>
        .app-spinner .spinner-group {
          transform-origin: center;
          animation: app-spinner-rotate 2s linear infinite;
        }
        .app-spinner .spinner-path {
          stroke: currentColor;
          stroke-linecap: round;
          animation: app-spinner-stretch 1.5s ease-in-out infinite;
        }
        @keyframes app-spinner-rotate {
          100% { transform: rotate(360deg); }
        }
        @keyframes app-spinner-stretch {
          0% { stroke-dasharray: 1, 150; stroke-dashoffset: 0; }
          50% { stroke-dasharray: 90, 150; stroke-dashoffset: -35; }
          100% { stroke-dasharray: 90, 150; stroke-dashoffset: -124; }
        }
        @media (prefers-reduced-motion: reduce) {
          .app-spinner .spinner-group { animation: none; }
          .app-spinner .spinner-path {
            stroke-dasharray: 80, 150;
            stroke-dashoffset: 0;
            animation: app-spinner-pulse 2s ease-in-out infinite;
          }
          @keyframes app-spinner-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
        }
      </style>
      <circle
        cx="25" cy="25" r="20"
        fill="none"
        stroke="currentColor"
        stroke-width="5"
        opacity="0.15"
      />
      <g class="spinner-group">
        <circle
          class="spinner-path"
          cx="25" cy="25" r="20"
          fill="none"
          stroke-width="5"
        />
      </g>
    </svg>
  `,
  styles: [`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 0;
    }
  `],
})
export class SpinnerComponent {
  readonly size = input<number>(20);
}
