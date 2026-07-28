import type { Product } from '../mercadolivre/affiliateLink';

export function buildPostText(product: Product, affiliateLink: string): string {
  const price = product.price.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${product.title} por R$${price} — confira: ${affiliateLink}`;
}
