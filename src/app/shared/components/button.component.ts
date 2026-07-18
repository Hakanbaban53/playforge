import { Component, input } from '@angular/core';
import { SpinnerComponent } from './spinner.component';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
type ButtonSize = 'sm' | 'md' | 'lg';


@Component({
  selector: 'app-button',
  standalone: true,
  imports: [SpinnerComponent],
  template: `
    <button
      [type]="type()"
      [disabled]="disabled()"
      [class]="'btn btn--' + variant() + ' btn--' + size()"
    >
      @if (loading()) {
        <app-spinner [size]="14" />
      }
      <ng-content />
    </button>
  `,
  styles: [
    `
      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        border: 1px solid transparent;
        border-radius: var(--radius-md);
        font-weight: 600;
        font-size: 14px;
        font-family: inherit;
        cursor: pointer;
        transition: background var(--motion-fast), border-color var(--motion-fast),
          transform var(--motion-fast), box-shadow var(--motion-fast),
          color var(--motion-fast);
        white-space: nowrap;
        user-select: none;
      }
      .btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .btn:not(:disabled):active {
        transform: translateY(1px);
      }
      .btn:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--brand-focus-ring);
      }
      .btn--primary:focus-visible,
      .btn--accent:focus-visible,
      .btn--danger:focus-visible {
        box-shadow: 0 0 0 3px var(--brand-focus-ring);
      }

      .btn--sm {
        padding: 6px 10px;
        font-size: 12px;
      }
      .btn--md {
        padding: 9px 16px;
      }
      .btn--lg {
        padding: 12px 22px;
        font-size: 15px;
      }

      .btn--primary {
        background: var(--brand-600);
        color: var(--text-on-brand);
      }
      .btn--primary:not(:disabled):hover {
        background: var(--brand-700);
        box-shadow: var(--shadow-sm);
      }

      .btn--accent {
        background: var(--accent-500);
        color: var(--text-on-brand);
      }
      .btn--accent:not(:disabled):hover {
        background: var(--accent-600);
        box-shadow: var(--shadow-sm);
      }

      .btn--secondary {
        background: var(--surface-0);
        color: var(--text-base);
        border-color: var(--surface-300);
      }
      .btn--secondary:not(:disabled):hover {
        border-color: var(--brand-400);
        color: var(--brand-700);
      }

      .btn--ghost {
        background: transparent;
        color: var(--text-muted);
      }
      .btn--ghost:not(:disabled):hover {
        background: var(--surface-100);
        color: var(--text-base);
      }

      .btn--danger {
        background: var(--danger-500);
        color: #fff;
      }
      .btn--danger:not(:disabled):hover {
        background: var(--danger-700);
        box-shadow: var(--shadow-sm);
      }
    `,
  ],
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  readonly disabled = input<boolean>(false);
  readonly loading = input<boolean>(false);
}
