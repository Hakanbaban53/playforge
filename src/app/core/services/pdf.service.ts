import { Injectable, inject } from '@angular/core';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { InvoiceService } from './invoice.service';
import { ReceiptLayoutService } from './receipt-layout.service';
import { ReceiptHtmlBuilder } from './receipt-html-builder.service';
import { ImageResolverService } from './image-resolver.service';
import { parseStoredFileRef } from './file-storage.adapter';

/**
 * Client-side PDF service — multi-page, element-aware pagination.
 *
 * Strategy: instead of rendering the entire receipt as one giant canvas
 * and slicing it at pixel boundaries (which cut elements in half), we:
 *
 *   1. Render the full HTML off-DOM.
 *   2. Walk the top-level elements inside `.sheet`.
 *   3. Group elements into "pages" — each page contains as many elements
 *      as fit within one page height (A4 = 1123px at 96dpi, we use 1080px
 *      to leave some margin).
 *   4. For each page group, render ONLY those elements into a fresh
 *      container, html2canvas that container, and add the canvas as a
 *      full page to jsPDF.
 *
 * This guarantees:
 *   - No element is split across pages (each element is atomic).
 *   - Each PDF page is a complete, self-contained snapshot.
 *   - Large images get their own page if needed.
 *   - The on-screen preview shows page breaks visually.
 */
@Injectable({ providedIn: 'root' })
export class PdfService {
  private readonly invoiceService = inject(InvoiceService);
  private readonly receiptLayout = inject(ReceiptLayoutService);
  private readonly htmlBuilder = inject(ReceiptHtmlBuilder);
  private readonly imageResolver = inject(ImageResolverService);

  /** A4 page height in CSS pixels at 96dpi (297mm ≈ 1123px, minus padding). */
  private static readonly PAGE_HEIGHT_PX = 1080;
  private static readonly PAGE_WIDTH_PX = 794;

  async downloadPdf(fileName: string): Promise<number> {
    const invoice = this.invoiceService.active();
    const layout = this.receiptLayout.layout();
    const paperSize = invoice.meta.paperSize;

    // 1. Build the full HTML and render off-DOM to extract element HTML.
    const fullHtml = this.htmlBuilder.build(invoice, layout);
    const tempContainer = document.createElement('div');
    tempContainer.style.position = 'fixed';
    tempContainer.style.left = '-99999px';
    tempContainer.style.top = '0';
    tempContainer.style.width = `${PdfService.PAGE_WIDTH_PX}px`;
    tempContainer.style.background = '#ffffff';
    tempContainer.innerHTML = fullHtml;
    document.body.appendChild(tempContainer);

    try {
      // 2. Pre-resolve images in the temp container.
      await this.preResolveImages(tempContainer);
      await this.inlineImages(tempContainer);

      // 3. Extract the <style> block and individual element nodes.
      const styleBlock = tempContainer.querySelector('style')?.outerHTML ?? '';
      const sheet = tempContainer.querySelector('.sheet') ?? tempContainer;
      const elementNodes = Array.from(sheet.children).filter(
        (n) => n.tagName.toLowerCase() !== 'style',
      );

      // 4. Group elements into pages based on measured heights.
      const pages = this.groupIntoPages(elementNodes);

      // 5. Create the PDF.
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: paperSize.toLowerCase() as 'a4' | 'a5' | 'letter',
        compress: true,
      });

      const pageWidth = pdf.internal.pageSize.getWidth();

      for (let i = 0; i < pages.length; i++) {
        if (i > 0) pdf.addPage();

        // Build a fresh container with just this page's elements.
        const pageContainer = document.createElement('div');
        pageContainer.style.position = 'fixed';
        pageContainer.style.left = '-99999px';
        pageContainer.style.top = '0';
        pageContainer.style.width = `${PdfService.PAGE_WIDTH_PX}px`;
        pageContainer.style.background = '#ffffff';
        pageContainer.innerHTML = `<style>${styleBlock.replace(/<[^>]*>/g, '')}</style><div class="sheet">${pages[i].map((n) => (n as HTMLElement).outerHTML).join('')}</div>`;
        document.body.appendChild(pageContainer);

        try {
          // Inline images in this page container too.
          await this.inlineImages(pageContainer);

          const canvas = await html2canvas(pageContainer, {
            scale: 2,
            backgroundColor: '#ffffff',
            useCORS: true,
            logging: false,
            windowWidth: pageContainer.scrollWidth,
            windowHeight: pageContainer.scrollHeight,
          });

          // Add canvas to the PDF page, scaled to fit the page width.
          const imgWidth = pageWidth;
          const imgHeight = (canvas.height * imgWidth) / canvas.width;
          const imgData = canvas.toDataURL('image/jpeg', 0.92);
          pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);
        } finally {
          document.body.removeChild(pageContainer);
        }
      }

      // 6. Download.
      const blob = pdf.output('blob');
      this.triggerDownload(blob, fileName);
      return pages.length;
    } finally {
      document.body.removeChild(tempContainer);
    }
  }

  /**
   * Group top-level elements into pages. Each page contains as many
   * elements as fit within PAGE_HEIGHT_PX. If a single element is taller
   * than the page height, it gets its own page.
   */
  private groupIntoPages(elements: Element[]): Element[][] {
    const pages: Element[][] = [];
    let currentPage: Element[] = [];
    let currentHeight = 0;

    for (const el of elements) {
      const height = (el as HTMLElement).offsetHeight;
      // Count both top + bottom margins — counting only one under-counts
      // elements and can split them across pages.
      const style = getComputedStyle(el);
      const marginTotal =
        (parseInt(style.marginTop) || 0) + (parseInt(style.marginBottom) || 0);
      const totalHeight = height + marginTotal;

      if (currentHeight + totalHeight > PdfService.PAGE_HEIGHT_PX && currentPage.length > 0) {
        // Start a new page.
        pages.push(currentPage);
        currentPage = [];
        currentHeight = 0;
      }

      currentPage.push(el);
      currentHeight += totalHeight;
    }

    if (currentPage.length > 0) {
      pages.push(currentPage);
    }

    return pages.length > 0 ? pages : [[]];
  }

  private async preResolveImages(root: HTMLElement): Promise<void> {
    const imgs = Array.from(root.querySelectorAll('img'));
    await Promise.all(
      imgs.map(async (img) => {
        const src = img.getAttribute('src');
        if (!src) return;
        const ref = parseStoredFileRef(src);
        if (!ref) return;
        const resolved = await this.imageResolver.resolve(src);
        img.setAttribute('src', resolved);
      }),
    );
  }

  private async inlineImages(root: HTMLElement): Promise<void> {
    const imgs = Array.from(root.querySelectorAll('img'));
    await Promise.all(
      imgs.map(async (img) => {
        const src = img.getAttribute('src');
        if (!src || src.startsWith('data:')) return;
        try {
          const dataUri = await this.fetchAsDataUri(src);
          img.setAttribute('src', dataUri);
          await new Promise<void>((resolve) => {
            const tmp = new Image();
            tmp.onload = () => resolve();
            tmp.onerror = () => resolve();
            tmp.src = dataUri;
          });
        } catch (err) {
          console.warn(`[PDF] Failed to inline image ${src}:`, err);
          img.setAttribute(
            'src',
            'data:image/svg+xml;base64,' +
              btoa(
                `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="100%" height="100%" fill="#f1f5f7"/><text x="50%" y="50%" font-family="sans-serif" font-size="14" fill="#6b7782" text-anchor="middle" dominant-baseline="middle">image unavailable</text></svg>`,
              ),
          );
        }
      }),
    );
  }

  private async fetchAsDataUri(url: string): Promise<string> {
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      return await this.blobToDataUri(blob);
    } catch {
      return this.canvasDataUri(url);
    }
  }

  private blobToDataUri(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  private canvasDataUri(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 400;
        canvas.height = img.naturalHeight || 300;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('No 2D context')); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        try { resolve(canvas.toDataURL('image/png')); }
        catch (err) { reject(err); }
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  private triggerDownload(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}
