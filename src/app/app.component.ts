import {
  Component,
  signal,
  computed,
  inject,
  HostListener,
} from "@angular/core";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { type } from "@tauri-apps/plugin-os";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { MatTableModule } from "@angular/material/table";
import { MatInputModule } from "@angular/material/input";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { MatSlideToggleModule } from "@angular/material/slide-toggle";
import { MatTooltipModule } from "@angular/material/tooltip";
import { Product } from "./models/product.model";
import { InvoiceService } from "./services/invoice.service";
import { AddProductComponent } from "./components/add-product/add-product";
import { TitlebarComponent } from "./components/titlebar/titlebar";
import { InvoiceLayoutService } from "./services/invoice-layout.service";
import { InvoiceRendererComponent } from "./components/invoice-renderer/invoice-renderer";
import { InvoiceOverlayService } from "./services/invoice-overlay.service";
import { TranslateService, TranslateModule } from "@ngx-translate/core";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatInputModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatDialogModule,
    MatSlideToggleModule,
    MatTooltipModule,
    TranslateModule,
    TitlebarComponent,
    InvoiceRendererComponent,
  ],
  templateUrl: "./app.component.html",
  styleUrls: ["./app.component.scss"],
})
export class AppComponent {
  private invoiceService = inject(InvoiceService);
  private dialog = inject(MatDialog);
  private overlayService = inject(InvoiceOverlayService);
  private translate = inject(TranslateService);

  productCode = signal("");
  invoiceItems = signal<Product[]>([]);
  products = signal<Product[]>([]);
  searchQuery = signal("");
  isMobile = signal(false); // OS Check for Titlebar/System UI
  isSmallScreen = signal(false); // Window width check for Drawer mode
  isInvoiceDrawerOpen = signal(false);
  sidebarWidth = signal(400);
  isResizing = signal(false);
  private resizeStartX = 0;
  private resizeStartWidth = 0;

  showPreview = signal(false);
  private layoutService = inject(InvoiceLayoutService);
  layout = this.layoutService.layout;
  currency = this.layoutService.currency;
  paperSize = this.layoutService.paperSize;
  taxes = this.layoutService.taxes;

  displayedColumns: string[] = [
    "quantity",
    "code",
    "name",
    "price",
    "total",
    "actions",
  ];
  today = new Date();

  total = computed(() => {
    return this.invoiceItems().reduce(
      (acc, item) => acc + item.price * (item.quantity || 1),
      0,
    );
  });

  totalTax = computed(() => {
    return this.taxes()
      .filter((tax) => tax.enabled && tax.value !== 0)
      .reduce((sum, tax) => {
        if (tax.type === "fixed") return sum + tax.value;
        return sum + this.total() * (tax.value / 100);
      }, 0);
  });

  activeTaxes = computed(() => {
    return this.taxes().filter((tax) => tax.enabled && tax.value !== 0);
  });

  totalWithTax = computed(() => {
    return this.total() + this.totalTax();
  });

  filteredProducts = computed(() => {
    const query = this.searchQuery().toLowerCase();
    return this.products().filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.code.toLowerCase().includes(query),
    );
  });

  constructor() {
    this.checkMobile();
    this.checkScreenSize();
    this.loadSettings();
    this.initializeLanguage();
    this.loadProducts();
  }

  async initializeLanguage() {
    this.translate.addLangs(["en", "tr"]);
    this.translate.setDefaultLang("en");

    try {
      const savedLang = await invoke<string | null>("get_setting", {
        key: "app_language",
      });

      if (savedLang && ["en", "tr"].includes(savedLang)) {
        this.translate.use(savedLang);
      } else {
        const browserLang = this.translate.getBrowserLang();
        const defaultLang = browserLang?.match(/en|tr/) ? browserLang : "en";
        this.translate.use(defaultLang);
        await invoke("save_setting", {
          key: "app_language",
          value: defaultLang,
        });
      }
    } catch (error) {
      console.error("Failed to load language preference:", error);
      const browserLang = this.translate.getBrowserLang();
      this.translate.use(browserLang?.match(/en|tr/) ? browserLang : "en");
    }
  }

  taxAmount(tax: any): number {
    if (tax.type === "fixed") return tax.value;
    return this.total() * (tax.value / 100);
  }

  taxLabel(tax: any): string {
    if (tax.type === "percent") {
      return `${tax.name} (${tax.value}%)`;
    }
    return tax.name;
  }

  async loadProducts() {
    const products = await this.invoiceService.getAllProducts();
    this.products.set(products);
  }

  async loadSettings() {
    try {
      const width = await invoke<string | null>("get_setting", {
        key: "sidebar_width",
      });
      if (width) {
        const parsed = parseInt(width, 10);
        if (!isNaN(parsed) && parsed >= 300 && parsed <= 800) {
          this.sidebarWidth.set(parsed);
        }
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  }

  checkMobile() {
    const osType = type();
    this.isMobile.set(osType === "android" || osType === "ios");
  }

  @HostListener("window:resize", ["$event"])
  onResize(event: any) {
    this.checkScreenSize();
  }

  checkScreenSize() {
    this.isSmallScreen.set(window.innerWidth <= 900);
  }

  async refreshProducts() {
    const products = await this.invoiceService.getAllProducts();
    this.products.set(products);
  }

  addToInvoice(product: Product) {
    this.invoiceItems.update((items) => {
      const existingItem = items.find((item) => item.code === product.code);
      if (existingItem) {
        return items.map((item) =>
          item.code === product.code
            ? { ...item, quantity: (item.quantity || 1) + 1 }
            : item,
        );
      }
      return [...items, { ...product, quantity: 1 }];
    });
  }

  async addProduct() {
    if (!this.productCode()) return;

    // Check locally first
    const localProduct = this.products().find(
      (p) => p.code === this.productCode(),
    );

    if (localProduct) {
      this.addToInvoice(localProduct);
      this.productCode.set("");
      return;
    }

    // Fallback to DB check (though products() should be in sync)
    const product = await this.invoiceService.getProductByCode(
      this.productCode(),
    );
    if (product) {
      this.addToInvoice(product);
      this.productCode.set("");
      // Update local cache if missing
      if (!this.products().find((p) => p.code === product.code)) {
        this.refreshProducts();
      }
    } else {
      // Product not found, open dialog with the code
      this.openAddProductDialog(this.productCode());
    }
  }

  openAddProductDialog(initialCode: string = "") {
    const dialogRef = this.dialog.open(AddProductComponent, {
      width: "600px",
      maxWidth: "80vw",
      height: "auto",
      maxHeight: "90vh",
      data: { code: initialCode },
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result) {
        await this.refreshProducts();
        if (initialCode) {
          const product = this.products().find((p) => p.code === initialCode);
          if (product) {
            this.addToInvoice(product);
            this.productCode.set("");
          }
        }
      }
    });
  }

  removeItem(index: number) {
    this.invoiceItems.update((items) => items.filter((_, i) => i !== index));
  }

  printInvoice() {
    window.print();
  }

  openLayoutEditor() {
    this.overlayService.open(this.invoiceItems);
  }

  editProduct(product: Product) {
    const dialogRef = this.dialog.open(AddProductComponent, {
      width: "600px",
      data: { product },
    });

    dialogRef.afterClosed().subscribe(async (result: any) => {
      if (result) {
        await this.loadProducts();
      }
    });
  }

  resolveImage(product: Product): string {
    const primaryInfo = product.images?.find((img) => img.is_primary);
    const imgUrl = primaryInfo?.url || product.images?.[0]?.url;
    return this.resolvePath(imgUrl);
  }

  resolvePath(path: string | undefined): string {
    if (!path) return "assets/placeholder.jpg";
    if (path.startsWith("http")) return path;
    if (path.startsWith("assets/")) return path;
    return convertFileSrc(path);
  }

  // ==========================================================================
  // RESIZE LOGIC
  // ==========================================================================
  startResizing(event: MouseEvent) {
    if (this.isMobile()) return;
    this.isResizing.set(true);
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = this.sidebarWidth();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  @HostListener("document:mouseup")
  stopResizing() {
    if (!this.isResizing()) return;
    this.isResizing.set(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    invoke("save_setting", {
      key: "sidebar_width",
      value: this.sidebarWidth().toString(),
    });
  }

  @HostListener("document:mousemove", ["$event"])
  onMouseMove(event: MouseEvent) {
    if (!this.isResizing()) return;

    // Sidebar is on the RIGHT.
    // Moving mouse LEFT (decreasing X) should INCREASE width.
    // Moving mouse RIGHT (increasing X) should DECREASE width.
    const deltaX = this.resizeStartX - event.clientX;
    const newWidth = this.resizeStartWidth + deltaX;

    // Constraints
    if (newWidth < 300) {
      this.sidebarWidth.set(300);
    } else if (newWidth > 800) {
      this.sidebarWidth.set(800);
    } else {
      this.sidebarWidth.set(newWidth);
    }
  }
}
