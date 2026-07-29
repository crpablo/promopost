import type { Product } from '../mercadolivre/affiliateLink';

const HASHTAGS = '#promocao #oferta #mercadolivre #desconto';

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function buildSocialCaption(
  product: Product,
  affiliateLink: string,
  coupon?: string,
  discountedPrice?: number,
): string {
  const linkLine = `🔗 Confira: ${affiliateLink}`;

  if (typeof discountedPrice === 'number') {
    const regularPrice = formatPrice(product.price);
    const discounted = formatPrice(discountedPrice);
    const priceLine = `🔥 De R$${regularPrice} por R$${discounted}`;
    const couponLine = coupon ? `\n\n🎟️ Cupom: ${coupon}` : '';
    return `${product.title}\n\n${priceLine}${couponLine}\n\n${linkLine}\n\n${HASHTAGS}`;
  }

  const price = formatPrice(product.price);
  return `${product.title}\n\n🏷️ R$${price}\n\n${linkLine}\n\n${HASHTAGS}`;
}
