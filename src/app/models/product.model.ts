export interface ProductImage {
  id?: number;
  url: string;
  is_primary: boolean;
}

export interface Product {
  id: number;
  code: string;
  name: string;
  unit: string;
  price: number;
  images: ProductImage[];
  quantity?: number;
}
