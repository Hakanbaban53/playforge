import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  async confirm(message: string, title = 'Confirm'): Promise<boolean> {
    if (typeof document === 'undefined') return true;

    if (typeof HTMLDialogElement !== 'undefined') {
      return this.confirmWithDialog(message, title);
    }

    return this.confirmWithFallback(message, title);
  }

  private confirmWithDialog(message: string, title: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.setAttribute('aria-labelledby', 'confirm-title');
      dialog.setAttribute('aria-describedby', 'confirm-message');
      dialog.style.border = 'none';
      dialog.style.borderRadius = '16px';
      dialog.style.padding = '0';
      dialog.style.maxWidth = '420px';
      dialog.style.width = 'calc(100vw - 32px)';
      dialog.style.boxShadow = '0 24px 80px rgba(15, 23, 42, 0.28)';

      dialog.innerHTML = `
        <form method="dialog" style="padding: 20px; background: #fff; color: #111827; font-family: inherit;">
          <h2 id="confirm-title" style="margin: 0 0 12px; font-size: 18px; line-height: 1.2;">${this.escapeHtml(title)}</h2>
          <p id="confirm-message" style="margin: 0; white-space: pre-wrap; color: #4b5563; line-height: 1.5;">${this.escapeHtml(message)}</p>
          <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
            <button value="cancel" style="padding: 8px 14px; border-radius: 10px; border: 1px solid #d1d5db; background: #fff; color: #111827; cursor: pointer;">Cancel</button>
            <button value="confirm" style="padding: 8px 14px; border-radius: 10px; border: 1px solid #b91c1c; background: #dc2626; color: #fff; cursor: pointer;">Confirm</button>
          </div>
        </form>
      `;

      dialog.addEventListener('close', () => {
        const confirmed = dialog.returnValue === 'confirm';
        dialog.remove();
        resolve(confirmed);
      }, { once: true });

      document.body.appendChild(dialog);
      dialog.showModal();
    });
  }

  private confirmWithFallback(message: string, title: string): Promise<boolean> {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.display = 'grid';
    overlay.style.placeItems = 'center';
    overlay.style.background = 'rgba(15, 23, 42, 0.5)';
    overlay.style.zIndex = '2147483647';

    const panel = document.createElement('div');
    panel.style.maxWidth = '420px';
    panel.style.width = 'calc(100vw - 32px)';
    panel.style.background = '#fff';
    panel.style.color = '#111827';
    panel.style.borderRadius = '16px';
    panel.style.padding = '20px';
    panel.style.boxShadow = '0 24px 80px rgba(15, 23, 42, 0.28)';

    const heading = document.createElement('h2');
    heading.textContent = title;
    heading.style.margin = '0 0 12px';
    heading.style.fontSize = '18px';

    const body = document.createElement('p');
    body.textContent = message;
    body.style.margin = '0';
    body.style.whiteSpace = 'pre-wrap';
    body.style.color = '#4b5563';
    body.style.lineHeight = '1.5';

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.justifyContent = 'flex-end';
    actions.style.gap = '10px';
    actions.style.marginTop = '20px';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.style.padding = '8px 14px';
    cancel.style.borderRadius = '10px';
    cancel.style.border = '1px solid #d1d5db';
    cancel.style.background = '#fff';
    cancel.style.color = '#111827';
    cancel.style.cursor = 'pointer';

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.textContent = 'Confirm';
    confirm.style.padding = '8px 14px';
    confirm.style.borderRadius = '10px';
    confirm.style.border = '1px solid #b91c1c';
    confirm.style.background = '#dc2626';
    confirm.style.color = '#fff';
    confirm.style.cursor = 'pointer';

    return new Promise<boolean>((resolve) => {
      const finish = (value: boolean): void => {
        overlay.remove();
        resolve(value);
      };

      cancel.addEventListener('click', () => finish(false), { once: true });
      confirm.addEventListener('click', () => finish(true), { once: true });
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) finish(false);
      }, { once: true });
      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') finish(false);
      }, { once: true });

      actions.append(cancel, confirm);
      panel.append(heading, body, actions);
      overlay.append(panel);
      document.body.appendChild(overlay);
      confirm.focus();
    });
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