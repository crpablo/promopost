import type { Product } from '../marketplace/types';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function buildPostText(
  product: Product,
  affiliateLink: string,
  coupon?: string,
  discountedPrice?: number,
): string {
  const safeLink = escapeHtml(affiliateLink);
  const linkLine = `🔗 Confira: <a href="${safeLink}">${safeLink}</a>`;

  if (typeof discountedPrice === 'number') {
    const regularPrice = formatPrice(product.price);
    const discounted = formatPrice(discountedPrice);
    const priceLine = `🔥 De <s>R$${regularPrice}</s> por <strong>R$${discounted}</strong>`;
    const couponLine = coupon ? `<br><br>🎟️ Cupom: <strong>${escapeHtml(coupon)}</strong>` : '';
    return `${priceLine}${couponLine}<br><br>${linkLine}`;
  }

  const price = formatPrice(product.price);
  return `🏷️ <strong>R$${price}</strong><br><br>${linkLine}`;
}
