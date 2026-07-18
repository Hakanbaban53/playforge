import { Injectable } from '@angular/core';


/**
 * Confirmation dialog service.
 *
 * Renders a styled `<dialog>` modal for "are you sure?" prompts (delete
 * customer, reset catalog, reset receipt layout, etc.). The dialog markup
 * and styles live in `styles.scss` under the `.app-confirm-*` namespace so
 * the popup pulls from the same design-system tokens (brand colors, surface
 * tokens, motion, typography) as the rest of the app — no inline styles, no
 * one-off hardcoded values.
 *
 * Styles are injected once into `<head>` on first use (idempotent — the
 * `<style>` tag is keyed by `data-app-confirm-styles` so a second injection
 * is a no-op). They reference `var(--xxx)` tokens, so dark-mode and any
 * future theme override apply automatically.
 *
 * Falls back to `window.confirm` only when the `<dialog>` element is not
 * supported (very old browsers / SSR).
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  async confirm(message: string, title = 'Confirm'): Promise<boolean> {
    if (typeof document === 'undefined' || typeof HTMLDialogElement === 'undefined') {
      return window.confirm(message);
    }
    return this.confirmWithDialog(message, title);
  }

  private confirmWithDialog(message: string, title: string): Promise<boolean> {
    this.ensureStylesInjected();

    return new Promise<boolean>((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'app-confirm';
      dialog.setAttribute('aria-labelledby', 'app-confirm-title');
      dialog.setAttribute('aria-describedby', 'app-confirm-message');

      dialog.innerHTML = `
        <form class="app-confirm__form">
          <h2 id="app-confirm-title" class="app-confirm__title">${this.escapeHtml(title)}</h2>
          <p id="app-confirm-message" class="app-confirm__message">${this.escapeHtml(message)}</p>
          <div class="app-confirm__actions">
            <button type="button" value="cancel" class="app-confirm__btn app-confirm__btn--cancel">
              ${this.escapeHtml(this.cancelLabel())}
            </button>
            <button type="button" value="confirm" class="app-confirm__btn app-confirm__btn--confirm" autofocus>
              ${this.escapeHtml(this.confirmLabel())}
            </button>
          </div>
        </form>
      `;

      let resolved = false;
      const finish = (value: boolean): void => {
        if (resolved) return;
        resolved = true;
        // Play the exit animation, then actually close after it completes.
        dialog.classList.add('app-confirm--leaving');
        window.setTimeout(() => {
          if (dialog.open) dialog.close();
          dialog.remove();
          resolve(value);
        }, 180);
      };

      // Button clicks — read the value attr to know which button was hit.
      dialog.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'BUTTON') {
          e.preventDefault();
          const value = (target as HTMLButtonElement).value === 'confirm';
          finish(value);
        }
      });

      // ESC key — the browser fires the 'close' event with empty returnValue.
      // Resolve with false (cancel) and clean up. No exit animation because
      // the browser already closed the dialog synchronously.
      dialog.addEventListener('close', () => {
        if (!resolved) {
          resolved = true;
          dialog.remove();
          resolve(false);
        }
      });

      document.body.appendChild(dialog);
      dialog.showModal();
    });
  }

  /** Cancel/Confirm button labels. Kept inline rather than pulled from i18n
   *  because the dialog is created outside Angular's DI scope — and these
   *  two labels are stable across locales (the surrounding title/message
   *  text is already i18n'd by the caller). */
  private cancelLabel(): string {
    return 'Cancel';
  }

  private confirmLabel(): string {
    return 'Confirm';
  }

  /**
   * Inject the dialog styles into <head> exactly once. Subsequent calls are
   * a no-op (detected by the `data-app-confirm-styles` marker on the style
   * tag). Using a real <style> tag instead of inline styles means the rules
   * can reference CSS custom properties (`var(--brand-600)` etc.) and get
   * dark-mode / theme overrides for free.
   */
  private ensureStylesInjected(): void {
    if (document.head.querySelector('style[data-app-confirm-styles]')) return;

    const style = document.createElement('style');
    style.setAttribute('data-app-confirm-styles', '');
    style.textContent = `
      .app-confirm {
        border: none;
        border-radius: var(--radius-lg);
        padding: 0;
        max-width: 420px;
        width: calc(100vw - 32px);
        background: var(--surface-0);
        color: var(--text-base);
        box-shadow: var(--shadow-lg);
        font-family: var(--font-sans);
        animation: app-confirm-enter var(--motion-base) var(--ease-decelerate) both;
        transition: opacity var(--motion-base) var(--ease-accelerate),
                    transform var(--motion-base) var(--ease-accelerate);
      }
      .app-confirm::backdrop {
        background: rgba(15, 23, 32, 0.45);
        backdrop-filter: blur(2px);
        animation: app-confirm-backdrop-enter var(--motion-base) both;
        transition: opacity var(--motion-base) var(--ease-accelerate);
      }
      .app-confirm--leaving {
        animation: app-confirm-exit var(--motion-base) var(--ease-accelerate) both;
      }
      .app-confirm--leaving::backdrop {
        animation: app-confirm-backdrop-exit var(--motion-base) var(--ease-accelerate) both;
      }
      .app-confirm__form {
        padding: var(--space-6);
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }
      .app-confirm__title {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
        line-height: 1.2;
        color: var(--text-strong);
        letter-spacing: -0.01em;
      }
      .app-confirm__message {
        margin: 0;
        font-size: 14px;
        line-height: 1.5;
        color: var(--text-muted);
        white-space: pre-wrap;
      }
      .app-confirm__actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-2);
        margin-top: var(--space-4);
      }
      .app-confirm__btn {
        font-family: inherit;
        font-size: 14px;
        font-weight: 600;
        padding: 9px 16px;
        border-radius: var(--radius-md);
        border: 1px solid transparent;
        cursor: pointer;
        transition: background var(--motion-fast), border-color var(--motion-fast),
          transform var(--motion-fast), color var(--motion-fast);
        white-space: nowrap;
      }
      .app-confirm__btn:not(:disabled):active {
        transform: translateY(1px);
      }
      .app-confirm__btn:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--brand-focus-ring);
      }
      .app-confirm__btn--cancel {
        background: var(--surface-0);
        color: var(--text-base);
        border-color: var(--surface-300);
      }
      .app-confirm__btn--cancel:hover {
        border-color: var(--brand-400);
        color: var(--brand-700);
      }
      .app-confirm__btn--confirm {
        background: var(--brand-600);
        color: var(--text-on-brand);
      }
      .app-confirm__btn--confirm:hover {
        background: var(--brand-700);
        box-shadow: var(--shadow-sm);
      }
      @keyframes app-confirm-enter {
        from { opacity: 0; transform: scale(0.96); }
        to   { opacity: 1; transform: scale(1); }
      }
      @keyframes app-confirm-exit {
        from { opacity: 1; transform: scale(1); }
        to   { opacity: 0; transform: scale(0.96); }
      }
      @keyframes app-confirm-backdrop-enter {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      @keyframes app-confirm-backdrop-exit {
        from { opacity: 1; }
        to   { opacity: 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        .app-confirm,
        .app-confirm::backdrop,
        .app-confirm--leaving,
        .app-confirm--leaving::backdrop { animation: none; }
      }
    `;
    document.head.appendChild(style);
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
