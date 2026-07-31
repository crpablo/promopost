export interface Product {
  title: string;
  price: number;
  imageUrl: string;
  marketplace?: 'mercadolivre' | 'shopee';
}
