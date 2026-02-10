import { Injectable } from "@angular/core";
import { invoke } from "@tauri-apps/api/core";
import { Product, ProductImage } from "../models/product.model";

@Injectable({
  providedIn: "root",
})
export class InvoiceService {
  constructor() {}

  async getProductByCode(code: string): Promise<Product | null> {
    try {
      return await invoke<Product | null>("get_product_by_code", { code });
    } catch (error) {
      console.error("Error fetching product:", error);
      return null;
    }
  }

  async addProduct(product: {
    code: string;
    name: string;
    unit: string;
    price: number;
    images: ProductImage[];
  }): Promise<void> {
    try {
      await invoke("add_product", product);
      // await this.refreshProducts(); // Assuming this method will be added later or is a placeholder
    } catch (error) {
      console.error("Error adding product:", error);
      throw error;
    }
  }

  async updateProduct(product: {
    code: string;
    name: string;
    unit: string;
    price: number;
    images: ProductImage[];
  }): Promise<void> {
    try {
      await invoke("update_product", product);
      // await this.refreshProducts(); // Assuming this method will be added later or is a placeholder
    } catch (error) {
      console.error("Error updating product:", error);
      throw error;
    }
  }

  async getAllProducts(): Promise<Product[]> {
    try {
      return await invoke<Product[]>("get_all_products");
    } catch (error) {
      console.error("Error fetching products:", error);
      return [];
    }
  }
}
