import type { Product } from '../mercadolivre/affiliateLink';

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
  const safeTitle = escapeHtml(product.title);
  const safeLink = escapeHtml(affiliateLink);

  if (discountedPrice !== undefined) {
    const regularPrice = formatPrice(product.price);
    const discounted = formatPrice(discountedPrice);
    const couponText = coupon ? ` com o cupom <strong>${escapeHtml(coupon)}</strong>` : '';
    return `${safeTitle} de <s>R$${regularPrice}</s> por <strong>R$${discounted}</strong>${couponText} — confira: <a href="${safeLink}">${safeLink}</a>`;
  }

  const price = formatPrice(product.price);
  return `${safeTitle} por <strong>R$${price}</strong> — confira: <a href="${safeLink}">${safeLink}</a>`;
}
