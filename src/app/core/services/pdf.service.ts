import { Injectable, inject } from '@angular/core';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { InvoiceService } from './invoice.service';
import { ReceiptLayoutService } from './receipt-layout.service';
import { ReceiptHtmlBuilder } from './receipt-html-builder.service';
import { ImageResolverService } from './image-resolver.service';

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
 * Image handling:
 *   All image references (`idb://`, `fbstorage://`, `https://`, etc.) are
 *   resolved to base64 data URIs BEFORE the HTML is inserted into the DOM.
 *   This prevents the browser from trying to load `fbstorage://` pseudo-URLs
 *   (which fail with `ERR_UNKNOWN_URL_SCHEME`) or Firebase Storage download
 *   URLs (which fail with CORS errors when `fetch()`-ed from localhost).
 *
 *   For `fbstorage://` refs, `resolveToDataUri()` downloads bytes via the
 *   Firebase Storage SDK (`getBytes`), which bypasses CORS entirely — no
 *   download URL, no `fetch()`, just the SDK's own authenticated transport.
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

    // 1. Build the full HTML.
    const fullHtml = this.htmlBuilder.build(invoice, layout);

    // 2. Pre-inline ALL images to data URIs BEFORE inserting into DOM.
    //    This is critical: if we insert the HTML first, the browser tries
    //    to load `fbstorage://` and Firebase download URLs immediately,
    //    causing ERR_UNKNOWN_URL_SCHEME and CORS errors. By replacing
    //    all image srcs with data URIs in the HTML string first, the
    //    browser never attempts to load the original URLs.
    const inlinedHtml = await this.inlineImageSrcsInHtml(fullHtml);

    // 3. Render off-DOM to extract element HTML.
    const tempContainer = document.createElement('div');
    tempContainer.style.position = 'fixed';
    tempContainer.style.left = '-99999px';
    tempContainer.style.top = '0';
    tempContainer.style.width = `${PdfService.PAGE_WIDTH_PX}px`;
    tempContainer.style.background = '#ffffff';
    tempContainer.innerHTML = inlinedHtml;
    document.body.appendChild(tempContainer);

    try {
      // 4. Extract the <style> block and individual element nodes.
      const styleBlock = tempContainer.querySelector('style')?.outerHTML ?? '';
      const sheet = tempContainer.querySelector('.sheet') ?? tempContainer;
      const elementNodes = Array.from(sheet.children).filter(
        (n) => n.tagName.toLowerCase() !== 'style',
      );

      // 5. Group elements into pages based on measured heights.
      const pages = this.groupIntoPages(elementNodes);

      // 6. Create the PDF.
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
        // The outerHTML already contains data URIs (from step 2), so
        // no further image resolution is needed here.
        const pageContainer = document.createElement('div');
        pageContainer.style.position = 'fixed';
        pageContainer.style.left = '-99999px';
        pageContainer.style.top = '0';
        pageContainer.style.width = `${PdfService.PAGE_WIDTH_PX}px`;
        pageContainer.style.background = '#ffffff';
        pageContainer.innerHTML = `<style>${styleBlock.replace(/<[^>]*>/g, '')}</style><div class="sheet">${pages[i].map((n) => (n as HTMLElement).outerHTML).join('')}</div>`;
        document.body.appendChild(pageContainer);

        try {
          // Wait for all images in this page to finish loading.
          await this.waitForImages(pageContainer);

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

      // 7. Download.
      const blob = pdf.output('blob');
      this.triggerDownload(blob, fileName);
      return pages.length;
    } finally {
      document.body.removeChild(tempContainer);
    }
  }

  /**
   * Find all `src="..."` attributes in the HTML string, resolve each
   * image reference to a base64 data URI, and return the HTML with
   * data URIs substituted in. This runs BEFORE the HTML is inserted
   * into the DOM, so the browser never tries to load `fbstorage://`
   * or Firebase download URLs.
   */
  private async inlineImageSrcsInHtml(html: string): Promise<string> {
    // Match all src="..." attributes (both single and double quotes).
    const srcRegex = /src=["']([^"']+)["']/g;
    const matches: { fullMatch: string; url: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = srcRegex.exec(html)) !== null) {
      matches.push({ fullMatch: m[0], url: m[1] });
    }

    if (matches.length === 0) return html;

    // Resolve all unique image URLs to data URIs in parallel.
    const uniqueUrls = [...new Set(matches.map((x) => x.url))];
    const dataUriMap = new Map<string, string>();
    await Promise.all(
      uniqueUrls.map(async (url) => {
        const dataUri = await this.imageResolver.resolveToDataUri(url);
        dataUriMap.set(url, dataUri || this.placeholderDataUri());
      }),
    );

    // Replace all src="..." in the HTML with the data URIs.
    let result = html;
    for (const { fullMatch, url } of matches) {
      const dataUri = dataUriMap.get(url) ?? this.placeholderDataUri();
      result = result.replace(fullMatch, `src="${dataUri}"`);
    }
    return result;
  }

  /** Wait for all <img> elements in a container to finish loading. */
  private waitForImages(root: HTMLElement): Promise<void> {
    const imgs = Array.from(root.querySelectorAll('img'));
    return Promise.all(
      imgs.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete && img.naturalWidth > 0) {
              resolve();
              return;
            }
            img.onload = () => resolve();
            img.onerror = () => resolve();
          }),
      ),
    ).then(() => undefined);
  }

  /** SVG placeholder for images that fail to load. */
  private placeholderDataUri(): string {
    return (
      'data:image/svg+xml;base64,' +
      btoa(
        `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="100%" height="100%" fill="#f1f5f7"/><text x="50%" y="50%" font-family="sans-serif" font-size="14" fill="#6b7782" text-anchor="middle" dominant-baseline="middle">image unavailable</text></svg>`,
      )
    );
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
