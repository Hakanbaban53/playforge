import { Component, input } from '@angular/core';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Single-button primitive with shared styling and variant system.
 * Enterprise apps usually standardize on one Button component so theme
 * changes ripple everywhere consistently.
 *
 * Click handling: we deliberately do NOT bind a `(click)` handler on the
 * inner `<button>`. That way the native click event bubbles naturally up to
 * `<app-button>`'s host element, where consumer `(click)="..."` bindings
 * fire as expected. Binding a click handler on the inner button would
 * intercept the event before it bubbles, breaking consumer handlers.
 */
@Component({
  selector: 'app-button',
  standalone: true,
  template: `
    <button
      [type]="type()"
      [disabled]="disabled()"
      [class]="'btn btn--' + variant() + ' btn--' + size()"
    >
      @if (loading()) {
        <span class="btn__spinner" aria-hidden="true"></span>
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
          transform var(--motion-fast), box-shadow var(--motion-fast);
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

      .btn__spinner {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 2px solid currentColor;
        border-top-color: transparent;
        animation: spin 0.7s linear infinite;
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
