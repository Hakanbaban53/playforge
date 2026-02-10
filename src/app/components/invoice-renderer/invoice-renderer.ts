import { Component, Input, computed, signal, input, HostListener, ElementRef, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatCardModule } from "@angular/material/card";
import { MatTableModule } from "@angular/material/table";
import { MatIconModule } from "@angular/material/icon";
import { MatButtonModule } from "@angular/material/button";
import { TranslateModule } from "@ngx-translate/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Product } from "../../models/product.model";
import { LayoutElement, TaxLine } from "../../services/invoice-layout.service";

type RenderBlock =
  | { kind: "element"; element: LayoutElement }
  | { kind: "imageRow"; elements: LayoutElement[] };

@Component({
  selector: "app-invoice-renderer",
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatTableModule,
    MatIconModule,
    MatButtonModule,
    TranslateModule,
  ],
  templateUrl: "./invoice-renderer.html",
  styleUrls: ["./invoice-renderer.scss"],
})
export class InvoiceRendererComponent {
  layout = input.required<LayoutElement[]>();
  invoiceItems = input.required<Product[]>();
  currencyCode = input<string>("USD");
  paperSize = input<string>("A4");
  taxes = input<TaxLine[]>([]);

  zoom = signal<number>(100);
  private elementRef = inject(ElementRef);
  private touchStartDistance: number | null = null;
  private lastZoom: number = 100;
  
  today = new Date();

  // Updated columns: Name, Unit, Quantity, Price, Total
  displayedColumns: string[] = ["name", "unit", "quantity", "price", "total"];

  subTotal = computed(() => {
    return this.invoiceItems().reduce(
      (acc, item) => acc + item.price * (item.quantity || 1),
      0,
    );
  });

  activeTaxes = computed(() => {
    return this.taxes().filter((tax) => tax.enabled && tax.value !== 0);
  });

  taxAmount = (tax: TaxLine): number => {
    if (tax.type === "fixed") return tax.value;
    return this.subTotal() * (tax.value / 100);
  };

  totalTax = computed(() => {
    return this.activeTaxes().reduce((sum, tax) => sum + this.taxAmount(tax), 0);
  });

  grandTotal = computed(() => {
    return this.subTotal() + this.totalTax();
  });

  taxLabel(tax: TaxLine): string {
    if (tax.type === "percent") {
      return `${tax.name} (${tax.value}%)`;
    }
    return tax.name;
  }

  renderBlocks = computed<RenderBlock[]>(() => {
    const blocks: RenderBlock[] = [];
    const items = this.layout();
    let imageBuffer: LayoutElement[] = [];

    const flushImages = () => {
      if (imageBuffer.length > 0) {
        blocks.push({ kind: "imageRow", elements: imageBuffer });
        imageBuffer = [];
      }
    };

    for (const item of items) {
      if (!item.visible) {
        continue;
      }
      if (item.type === "image") {
        imageBuffer.push(item);
        continue;
      }
      flushImages();
      blocks.push({ kind: "element", element: item });
    }

    flushImages();

    return blocks;
  });

  translateUnit(unit: string | undefined): string {
    const u = unit || 'Adet';
    const unitMap: { [key: string]: string } = {
      'Adet': 'UNITS.ADET',
      'M2': 'UNITS.M2',
      'Takım': 'UNITS.TAKIM',
      'Kg': 'UNITS.KG',
      'Saat': 'UNITS.SAAT',
      'Gün': 'UNITS.GUN',
      'Ay': 'UNITS.AY'
    };
    return unitMap[u] || u;
  }

  isHtmlContent(content: string | undefined): boolean {
    if (!content) return false;
    return /<\/?[a-z][\s\S]*>/i.test(content);
  }

  textStyles(element: LayoutElement): { [key: string]: string } {
    const styles = element.styles || {};
    return {
      textAlign: styles["textAlign"] || "left",
      fontSize: styles["fontSize"] || (element.type === "header" ? "20px" : "14px"),
      fontWeight: styles["fontWeight"] || (element.type === "header" ? "600" : "400"),
      fontStyle: styles["fontStyle"] || "normal",
      textDecoration: styles["textDecoration"] || "none",
      color: styles["color"] || "#111827",
      lineHeight: styles["lineHeight"] || (element.type === "header" ? "1.3" : "1.4"),
    };
  }

  imageStyles(element: LayoutElement): { [key: string]: string } {
    const styles = element.styles || {};
    return {
      width: styles["imageWidth"] || "100%",
      maxWidth: "100%",
      maxHeight: styles["imageHeight"] || "200px",
      objectFit: styles["imageFit"] || "contain",
      borderRadius: styles["imageRadius"] || "0px",
      display: "block",
    };
  }

  imageStylesSingle(element: LayoutElement): { [key: string]: string } {
    const styles = element.styles || {};
    const rawWidth = styles["imageWidth"] || "100%";
    const useWidth = rawWidth !== "100%";
    return {
      width: useWidth ? rawWidth : "auto",
      maxWidth: "100%",
      maxHeight: styles["imageHeight"] || "200px",
      objectFit: styles["imageFit"] || "contain",
      borderRadius: styles["imageRadius"] || "0px",
      display: "block",
    };
  }

  imageWrapperStyles(element: LayoutElement): { [key: string]: string } {
    const align = element.styles?.["imageAlign"] || "center";
    if (align === "left") {
      return { display: "flex", justifyContent: "flex-start" };
    }
    if (align === "right") {
      return { display: "flex", justifyContent: "flex-end" };
    }
    return { display: "flex", justifyContent: "center" };
  }

  imageRowStyles(elements: LayoutElement[]): { [key: string]: string } {
    const perRow = this.getImagePerRow(elements[0]);
    return {
      display: "grid",
      gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))`,
      gap: "12px",
      alignItems: "center",
    };
  }

  imageRowItems(elements: LayoutElement[]): { src: string; element: LayoutElement }[] {
    const items: { src: string; element: LayoutElement }[] = [];
    for (const element of elements) {
      const sources = this.parseImageSources(element.content);
      for (const src of sources) {
        items.push({ src, element });
      }
    }
    return items;
  }

  isSingleImageRow(elements: LayoutElement[]): boolean {
    return this.imageRowItems(elements).length === 1;
  }

  private parseImageSources(content: string | undefined): string[] {
    if (!content) return [];
    return content
      .split(/\r?\n|,|;/g)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  private getImagePerRow(element: LayoutElement | undefined): number {
    const raw = element?.styles?.["imagePerRow"] || "3";
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
  }

  resolvePath(path: string | undefined): string {
    if (!path) return "assets/placeholder.jpg";
    if (path.startsWith("http")) return path;
    if (path.startsWith("assets/")) return path;
    return convertFileSrc(path);
  }

  @HostListener('wheel', ['$event'])
  onWheel(event: WheelEvent) {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const delta = -event.deltaY;
      const current = this.zoom();
      const change = delta > 0 ? 5 : -5;
      const newZoom = Math.min(200, Math.max(50, current + change));
      this.zoom.set(newZoom);
    }
  }

  @HostListener('touchstart', ['$event'])
  onTouchStart(event: TouchEvent) {
    if (event.touches.length === 2) {
      event.preventDefault();
      this.touchStartDistance = this.getTouchDistance(event.touches);
      this.lastZoom = this.zoom();
    }
  }

  @HostListener('touchmove', ['$event'])
  onTouchMove(event: TouchEvent) {
    if (event.touches.length === 2 && this.touchStartDistance) {
      event.preventDefault();
      const currentDistance = this.getTouchDistance(event.touches);
      const scale = currentDistance / this.touchStartDistance;
      const newZoom = Math.min(200, Math.max(50, this.lastZoom * scale));
      this.zoom.set(Math.round(newZoom));
    }
  }

  @HostListener('touchend', ['$event'])
  onTouchEnd(event: TouchEvent) {
    if (event.touches.length < 2) {
      this.touchStartDistance = null;
    }
  }

  private getTouchDistance(touches: TouchList): number {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  zoomIn() {
    const current = this.zoom();
    if (current < 200) {
      this.zoom.set(Math.min(200, current + 10));
    }
  }

  zoomOut() {
    const current = this.zoom();
    if (current > 50) {
      this.zoom.set(Math.max(50, current - 10));
    }
  }

  resetZoom() {
    this.zoom.set(100);
  }

  getZoomStyle(): { [key: string]: string } {
    const zoomValue = this.zoom() / 100;
    return {
      zoom: zoomValue.toString()
    };
  }
}
