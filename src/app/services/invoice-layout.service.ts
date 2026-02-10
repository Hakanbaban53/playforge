import { Injectable, signal } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";

export interface LayoutElement {
  id: string;
  type: "header" | "table" | "visuals" | "text" | "image" | "divider" | "meta";
  visible: boolean;
  order: number;
  content?: string; // For text/image
  styles?: { [key: string]: string };
  label?: string; // Display name for the editor
}

export interface TaxLine {
  id: string;
  name: string;
  type: "percent" | "fixed";
  value: number;
  enabled: boolean;
}

const DEFAULT_TEXT_STYLES: { [key: string]: string } = {
  textAlign: "left",
  fontSize: "14px",
  fontWeight: "400",
  fontStyle: "normal",
  textDecoration: "none",
  color: "#111827",
  lineHeight: "1.4",
};

const DEFAULT_HEADER_STYLES: { [key: string]: string } = {
  textAlign: "left",
  fontSize: "20px",
  fontWeight: "600",
  fontStyle: "normal",
  textDecoration: "none",
  color: "#111827",
  lineHeight: "1.3",
};

const DEFAULT_IMAGE_STYLES: { [key: string]: string } = {
  imageFit: "contain",
  imageAlign: "center",
  imageWidth: "100%",
  imageHeight: "200px",
  imageRadius: "0px",
  imagePerRow: "3",
};

const DEFAULT_LAYOUT: LayoutElement[] = [
  {
    id: "header",
    type: "header",
    visible: true,
    order: 0,
    label: "LAYOUT_ELEMENTS.HEADER",
    content:
      "ParkMan Services\n123 Park Avenue, Cityville\nPhone: (555) 123-4567 | Email: info@parkman.com",
    styles: DEFAULT_HEADER_STYLES,
  },
  {
    id: "meta",
    type: "meta",
    visible: true,
    order: 1,
    label: "LAYOUT_ELEMENTS.META",
  },
  {
    id: "table",
    type: "table",
    visible: true,
    order: 2,
    label: "LAYOUT_ELEMENTS.TABLE",
  },
  {
    id: "terms",
    type: "text",
    visible: true,
    order: 3,
    label: "LAYOUT_ELEMENTS.TERMS",
    content:
      "Terms & Conditions:\nPayment due within 30 days.\nThank you for your business!",
    styles: DEFAULT_TEXT_STYLES,
  },
  {
    id: "visuals",
    type: "visuals",
    visible: true,
    order: 4,
    label: "LAYOUT_ELEMENTS.VISUALS",
  },
];

const DEFAULT_TAXES: TaxLine[] = [
  {
    id: "vat",
    name: "VAT",
    type: "percent",
    value: 20,
    enabled: true,
  },
];

@Injectable({
  providedIn: "root",
})
export class InvoiceLayoutService {
  layout = signal<LayoutElement[]>(DEFAULT_LAYOUT);
  currency = signal<string>("USD");
  paperSize = signal<string>("A4");
  taxes = signal<TaxLine[]>(DEFAULT_TAXES);

  constructor() {
    this.loadLayout();
    this.loadCurrency();
    this.loadPaperSize();
    this.loadTaxes();
  }

  async loadPaperSize() {
    try {
      const saved = await invoke<string | null>("get_setting", {
        key: "invoice_paper_size",
      });
      if (saved) {
        this.paperSize.set(saved);
      }
    } catch (err) {
      console.error("Failed to load paper size", err);
    }
  }

  async savePaperSize(size: string) {
    try {
      await invoke("save_setting", {
        key: "invoice_paper_size",
        value: size,
      });
      this.paperSize.set(size);
    } catch (err) {
      console.error("Failed to save paper size", err);
    }
  }

  async loadTaxes() {
    try {
      const saved = await invoke<string | null>("get_setting", {
        key: "invoice_taxes",
      });
      if (saved) {
        const loaded = JSON.parse(saved) as TaxLine[];
        const normalized = loaded.map((tax) => this.normalizeTax(tax));
        this.taxes.set(normalized);
      }
    } catch (err) {
      console.error("Failed to load taxes", err);
    }
  }

  async saveTaxes(taxes: TaxLine[]) {
    try {
      await invoke("save_setting", {
        key: "invoice_taxes",
        value: JSON.stringify(taxes),
      });
      this.taxes.set(taxes);
    } catch (err) {
      console.error("Failed to save taxes", err);
    }
  }

  async loadCurrency() {
    try {
      const saved = await invoke<string | null>("get_setting", {
        key: "invoice_currency",
      });
      if (saved) {
        this.currency.set(saved);
      }
    } catch (err) {
      console.error("Failed to load currency", err);
    }
  }

  async saveCurrency(code: string) {
    try {
      await invoke("save_setting", {
        key: "invoice_currency",
        value: code,
      });
      this.currency.set(code);
    } catch (err) {
      console.error("Failed to save currency", err);
    }
  }

  async loadLayout() {
    // ... existing loadLayout code ...
    try {
      const saved = await invoke<string | null>("get_setting", {
        key: "invoice_layout",
      });
      if (saved) {
        let loaded = JSON.parse(saved) as LayoutElement[];
        // Sanitize: Ensure content is present for text/header types
        loaded = loaded.map((item) => this.normalizeElement(item));
        this.layout.set(loaded);
      }
    } catch (err) {
      console.error("Failed to load invoice layout", err);
    }
  }
  // ... existing methods ...

  async saveLayout(layout: LayoutElement[]) {
    try {
      await invoke("save_setting", {
        key: "invoice_layout",
        value: JSON.stringify(layout),
      });
      this.layout.set(layout);
    } catch (err) {
      console.error("Failed to save invoice layout", err);
    }
  }

  updateElement(id: string, updates: Partial<LayoutElement>) {
    this.layout.update((items) =>
      items.map((item) => (item.id === id ? { ...item, ...updates } : item)),
    );
    this.saveLayout(this.layout());
  }

  reorder(newOrder: LayoutElement[]) {
    // Update order property based on index
    const updated = newOrder.map((item, index) => ({ ...item, order: index }));
    this.saveLayout(updated);
  }

  addElement(type: "text" | "image") {
    const newId = `custom_${Date.now()}`;
    const newItem: LayoutElement = {
      id: newId,
      type: type,
      visible: true,
      order: this.layout().length,
      label: type === "text" ? "New Text Block" : "New Image",
      content: type === "text" ? "Edit this text..." : "",
      styles:
        type === "text" ? { ...DEFAULT_TEXT_STYLES } : { ...DEFAULT_IMAGE_STYLES },
    };

    this.layout.update((items) => [...items, newItem]);
    this.saveLayout(this.layout());
  }

  removeElement(id: string) {
    this.layout.update((items) => items.filter((i) => i.id !== id));
    this.saveLayout(this.layout());
  }

  resetToDefault() {
    this.saveLayout(DEFAULT_LAYOUT);
  }

  addTax() {
    const newTax: TaxLine = {
      id: `tax_${Date.now()}`,
      name: "New Tax",
      type: "percent",
      value: 5,
      enabled: true,
    };
    this.taxes.update((items) => [...items, newTax]);
    this.saveTaxes(this.taxes());
  }

  updateTax(id: string, updates: Partial<TaxLine>) {
    this.taxes.update((items) =>
      items.map((tax) => (tax.id === id ? { ...tax, ...updates } : tax)),
    );
    this.saveTaxes(this.taxes());
  }

  removeTax(id: string) {
    this.taxes.update((items) => items.filter((tax) => tax.id !== id));
    this.saveTaxes(this.taxes());
  }

  private normalizeElement(item: LayoutElement): LayoutElement {
    const normalized: LayoutElement = { ...item };

    if ((item.type === "header" || item.type === "text") && !item.content) {
      const defaultItem = DEFAULT_LAYOUT.find((d) => d.id === item.id);
      normalized.content = defaultItem?.content || "Edit this content...";
    }

    const defaultStyles = this.getDefaultStyles(item.type);
    if (defaultStyles) {
      normalized.styles = { ...defaultStyles, ...(item.styles || {}) };
    }

    return normalized;
  }

  private getDefaultStyles(type: LayoutElement["type"]): {
    [key: string]: string;
  } | null {
    if (type === "header") return DEFAULT_HEADER_STYLES;
    if (type === "text") return DEFAULT_TEXT_STYLES;
    if (type === "image") return DEFAULT_IMAGE_STYLES;
    return null;
  }

  private normalizeTax(tax: TaxLine): TaxLine {
    return {
      id: tax.id || `tax_${Date.now()}`,
      name: tax.name || "Tax",
      type: tax.type === "fixed" ? "fixed" : "percent",
      value: Number.isFinite(tax.value) ? tax.value : 0,
      enabled: tax.enabled !== false,
    };
  }
}
