import { Component, inject, output, signal, HostListener } from "@angular/core";
import { CommonModule } from "@angular/common";
import {
  CdkDragDrop,
  DragDropModule,
  moveItemInArray,
} from "@angular/cdk/drag-drop";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatCardModule } from "@angular/material/card";
import { MatSelectModule } from "@angular/material/select";
import { MatSlideToggleModule } from "@angular/material/slide-toggle";
import { MatTooltipModule } from "@angular/material/tooltip";
import { MatInputModule } from "@angular/material/input";
import { MatFormFieldModule } from "@angular/material/form-field";
import { FormsModule } from "@angular/forms";
import { TranslateModule } from "@ngx-translate/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  InvoiceLayoutService,
  LayoutElement,
  TaxLine,
} from "../../services/invoice-layout.service";
import { InvoiceRendererComponent } from "../invoice-renderer/invoice-renderer";
import { Product } from "../../models/product.model";

@Component({
  selector: "app-invoice-editor",
  standalone: true,
  imports: [
    CommonModule,
    DragDropModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
    MatInputModule,
    MatFormFieldModule,
    FormsModule,
    TranslateModule,
    InvoiceRendererComponent,
  ],
  templateUrl: "./invoice-editor.html",
  styleUrls: ["./invoice-editor.scss"],
})
export class InvoiceEditorComponent {
  layoutService = inject(InvoiceLayoutService);
  layout = this.layoutService.layout;
  currency = this.layoutService.currency;
  paperSize = this.layoutService.paperSize;
  taxes = this.layoutService.taxes;

  currencies = ["TRY", "USD", "EUR", "GBP"];
  paperSizes = ["A4", "A5", "Letter"];

  invoiceItems = signal<Product[]>([]);
  mobileViewMode = signal<"edit" | "preview">("edit"); // "edit" or "preview"
  taxesPanelExpanded = signal<boolean>(true);

  textSizes = ["12px", "14px", "16px", "18px", "20px", "24px"];
  textWeights = [
    { value: "400", labelKey: "COMMON.REGULAR" },
    { value: "600", labelKey: "COMMON.SEMI_BOLD" },
    { value: "700", labelKey: "COMMON.BOLD" },
  ];
  textAlignments = [
    { value: "left", labelKey: "COMMON.ALIGN_LEFT" },
    { value: "center", labelKey: "COMMON.ALIGN_CENTER" },
    { value: "right", labelKey: "COMMON.ALIGN_RIGHT" },
  ];
  textStyles = [
    { value: "normal", labelKey: "COMMON.STYLE_NORMAL" },
    { value: "italic", labelKey: "COMMON.STYLE_ITALIC" },
  ];
  textDecorations = [
    { value: "none", labelKey: "COMMON.DECORATION_NONE" },
    { value: "underline", labelKey: "COMMON.DECORATION_UNDERLINE" },
  ];
  imageFits = [
    { value: "contain", labelKey: "COMMON.FIT_CONTAIN" },
    { value: "cover", labelKey: "COMMON.FIT_COVER" },
  ];
  imageAlignments = [
    { value: "left", labelKey: "COMMON.ALIGN_LEFT" },
    { value: "center", labelKey: "COMMON.ALIGN_CENTER" },
    { value: "right", labelKey: "COMMON.ALIGN_RIGHT" },
  ];
  imagePerRowOptions = ["2", "3", "4"];
  taxTypes = [
    { value: "percent", labelKey: "TAXES.PERCENT" },
    { value: "fixed", labelKey: "TAXES.FIXED" },
  ];

  // Output to close
  close = output<void>();

  drop(event: CdkDragDrop<string[]>) {
    const currentLayout = this.layout();
    moveItemInArray(currentLayout, event.previousIndex, event.currentIndex);
    this.layoutService.reorder(currentLayout);
  }

  toggleVisibility(item: LayoutElement) {
    this.layoutService.updateElement(item.id, { visible: !item.visible });
  }

  updateCurrency(code: string) {
    this.layoutService.saveCurrency(code);
  }

  updatePaperSize(size: string) {
    this.layoutService.savePaperSize(size);
  }

  updateContent(item: LayoutElement, newContent: string) {
    this.layoutService.updateElement(item.id, { content: newContent });
  }

  async addImages(item: LayoutElement) {
    const selection = await open({
      multiple: true,
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"],
        },
      ],
    });

    if (!selection) {
      return;
    }

    const picked = Array.isArray(selection) ? selection : [selection];
    const existing = this.parseImageSources(item.content);
    const merged = [...existing, ...picked].filter(
      (value, index, array) => array.indexOf(value) === index,
    );

    this.updateContent(item, merged.join("\n"));
  }

  removeImage(item: LayoutElement, index: number) {
    const sources = this.parseImageSources(item.content);
    sources.splice(index, 1);
    this.updateContent(item, sources.join("\n"));
  }

  clearImages(item: LayoutElement) {
    this.updateContent(item, "");
  }

  updateStyle(item: LayoutElement, key: string, value: string) {
    const nextStyles = { ...(item.styles || {}), [key]: value };
    if (value === "" || value == null) {
      delete nextStyles[key];
    }
    this.layoutService.updateElement(item.id, { styles: nextStyles });
  }

  addText() {
    this.layoutService.addElement("text");
  }

  addImage() {
    this.layoutService.addElement("image");
  }

  remove(item: LayoutElement) {
    this.layoutService.removeElement(item.id);
  }

  reset() {
    this.layoutService.resetToDefault();
  }

  addTax() {
    this.layoutService.addTax();
  }

  updateTax(tax: TaxLine, updates: Partial<TaxLine>) {
    this.layoutService.updateTax(tax.id, updates);
  }

  removeTax(tax: TaxLine) {
    this.layoutService.removeTax(tax.id);
  }

  isRemovable(item: LayoutElement): boolean {
    return !["header", "table", "visuals", "meta"].includes(item.id);
  }

  isEditable(item: LayoutElement): boolean {
    return ["header", "text", "image"].includes(item.type);
  }

  displayContent(item: LayoutElement): string {
    const content = item.content || "";
    return this.isHtmlContent(content) ? this.htmlToText(content) : content;
  }

  imageSources(item: LayoutElement): string[] {
    return this.parseImageSources(item.content);
  }

  getStyle(item: LayoutElement, key: string, fallback: string): string {
    return item.styles?.[key] || fallback;
  }

  getDefaultTextStyle(item: LayoutElement, key: string): string {
    const defaults: Record<string, string> =
      item.type === "header"
        ? {
            textAlign: "left",
            fontSize: "20px",
            fontWeight: "600",
            fontStyle: "normal",
            textDecoration: "none",
            color: "#111827",
            lineHeight: "1.3",
          }
        : {
            textAlign: "left",
            fontSize: "14px",
            fontWeight: "400",
            fontStyle: "normal",
            textDecoration: "none",
            color: "#111827",
            lineHeight: "1.4",
          };

    return defaults[key] || "";
  }

  getDefaultImageStyle(key: string): string {
    const defaults: Record<string, string> = {
      imageFit: "contain",
      imageAlign: "center",
      imageWidth: "100%",
      imageHeight: "200px",
      imageRadius: "0px",
      imagePerRow: "3",
    };

    return defaults[key] || "";
  }

  trackByFn(index: number, item: LayoutElement): string {
    return item.id;
  }

  @HostListener("document:keydown.escape")
  onEscape() {
    this.close.emit();
  }

  private isHtmlContent(content: string): boolean {
    return /<\/?[a-z][\s\S]*>/i.test(content);
  }

  private htmlToText(html: string): string {
    return html
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/?p\s*>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();
  }

  private parseImageSources(content: string | undefined): string[] {
    if (!content) return [];
    return content
      .split(/\r?\n|,|;/g)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
}
