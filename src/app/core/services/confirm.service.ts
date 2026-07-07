import { Injectable } from '@angular/core';


@Injectable({ providedIn: 'root' })
export class ConfirmService {
  async confirm(message: string, title = 'Confirm'): Promise<boolean> {
    if (typeof document === 'undefined' || typeof HTMLDialogElement === 'undefined') {
      return window.confirm(message);
    }
    return this.confirmWithDialog(message, title);
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
        <form method="dialog" style="padding: 20px; background: var(--surface-0, #fff); color: var(--text-base, #111827); font-family: inherit;">
          <h2 id="confirm-title" style="margin: 0 0 12px; font-size: 18px; line-height: 1.2;">${this.escapeHtml(title)}</h2>
          <p id="confirm-message" style="margin: 0; white-space: pre-wrap; color: var(--text-muted, #4b5563); line-height: 1.5;">${this.escapeHtml(message)}</p>
          <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
            <button value="cancel" style="padding: 8px 14px; border-radius: 10px; box-shadow: 0 0 0 1px var(--surface-300, #d1d5db); background: var(--surface-0, #fff); color: var(--text-base, #111827); cursor: pointer;">Cancel</button>
            <button value="confirm" style="padding: 8px 14px; border-radius: 10px; box-shadow: 0 0 0 1px var(--brand-700, #0f6638); background: var(--brand-600, #138044); color: #fff; cursor: pointer;">Confirm</button>
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

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
