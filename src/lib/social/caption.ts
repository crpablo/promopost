import type { Product } from '../marketplace/types';

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildHashtags(marketplace: Product['marketplace']): string {
  const marketplaceTags: Record<string, string> = { shopee: '#shopee', amazon: '#amazon' };
  const marketplaceTag = marketplaceTags[marketplace ?? ''] ?? '#mercadolivre';
  return `#promocao #oferta ${marketplaceTag} #desconto`;
}

export function buildSocialCaption(
  product: Product,
  affiliateLink: string,
  coupon?: string,
  discountedPrice?: number,
): string {
  const linkLine = `🔗 Confira: ${affiliateLink} (também no link da bio)`;
  const hashtags = buildHashtags(product.marketplace);

  if (typeof discountedPrice === 'number') {
    const regularPrice = formatPrice(product.price);
    const discounted = formatPrice(discountedPrice);
    const priceLine = `🔥 De R$${regularPrice} por R$${discounted}`;
    const couponLine = coupon ? `\n\n🎟️ Cupom: ${coupon}` : '';
    return `${product.title}\n\n${priceLine}${couponLine}\n\n${linkLine}\n\n${hashtags}`;
  }

  const price = formatPrice(product.price);
  return `${product.title}\n\n🏷️ R$${price}\n\n${linkLine}\n\n${hashtags}`;
}
