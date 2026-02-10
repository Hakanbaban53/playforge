import { Component, signal, Inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import {
  MatDialogRef,
  MatDialogModule,
  MAT_DIALOG_DATA,
} from "@angular/material/dialog";
import { MatSelectModule } from "@angular/material/select";
import { MatAutocompleteModule } from "@angular/material/autocomplete";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { TranslateModule } from "@ngx-translate/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { InvoiceService } from "../../services/invoice.service";
import { ProductImage } from "../../models/product.model";

@Component({
  selector: "app-add-product",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    TranslateModule,
    MatSelectModule,
    MatAutocompleteModule,
  ],
  templateUrl: "./add-product.html",
  styleUrls: ["./add-product.scss"],
})
export class AddProductComponent {
  code = signal("");
  name = signal("");
  unit = signal("Adet");
  price = signal(0);
  images = signal<ProductImage[]>([]);
  isEditMode = signal(false);

  units = ["Adet", "M2", "Takım", "Kg", "Saat", "Gün", "Ay"];

  translateUnit(unit: string): string {
    const unitMap: { [key: string]: string } = {
      'Adet': 'UNITS.ADET',
      'M2': 'UNITS.M2',
      'Takım': 'UNITS.TAKIM',
      'Kg': 'UNITS.KG',
      'Saat': 'UNITS.SAAT',
      'Gün': 'UNITS.GUN',
      'Ay': 'UNITS.AY'
    };
    return unitMap[unit] || unit;
  }

  constructor(
    private dialogRef: MatDialogRef<AddProductComponent>,
    private invoiceService: InvoiceService,
    @Inject(MAT_DIALOG_DATA)
    public data: { code?: string; product?: any } | null,
  ) {
    if (this.data?.product) {
      this.isEditMode.set(true);
      this.code.set(this.data.product.code);
      this.name.set(this.data.product.name);
      this.unit.set(this.data.product.unit || "Adet");
      this.price.set(this.data.product.price);
      // Ensure we have an array
      this.images.set(this.data.product.images || []);
    } else if (this.data?.code) {
      this.code.set(this.data.code);
    }
  }

  getAssetUrl(path: string): string {
    return convertFileSrc(path);
  }

  async selectImages() {
    try {
      const selected = await openDialog({
        multiple: true,
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "webp"],
          },
        ],
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];

        for (const path of paths) {
          const savedPath = await invoke<string>("save_product_image", {
            filePath: path,
          });

          this.images.update((imgs) => [
            ...imgs,
            { url: savedPath, is_primary: imgs.length === 0 },
          ]);
        }
      }
    } catch (err) {
      console.error("Failed to select images:", err);
    }
  }

  setPrimary(index: number) {
    this.images.update((imgs) =>
      imgs.map((img, i) => ({ ...img, is_primary: i === index })),
    );
  }

  removeImage(index: number) {
    this.images.update((imgs) => {
      const newImgs = imgs.filter((_, i) => i !== index);
      // If we removed the primary image, make the first one primary if exists
      if (newImgs.length > 0 && !newImgs.some((img) => img.is_primary)) {
        newImgs[0].is_primary = true;
      }
      return newImgs;
    });
  }

  async save() {
    if (this.code() && this.name() && this.price() > 0) {
      try {
        const productData = {
          code: this.code(),
          name: this.name(),
          unit: this.unit(),
          price: this.price(),
          images: this.images(),
        };

        if (this.isEditMode()) {
          await this.invoiceService.updateProduct(productData);
        } else {
          await this.invoiceService.addProduct(productData);
        }

        this.dialogRef.close(true);
      } catch (error) {
        console.error("Save failed", error);
        alert("Failed to save product.");
      }
    }
  }

  cancel() {
    this.dialogRef.close(false);
  }
}
