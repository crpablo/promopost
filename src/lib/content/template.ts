import type { Product } from '../mercadolivre/affiliateLink';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildPostText(product: Product, affiliateLink: string): string {
  const price = product.price.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const safeTitle = escapeHtml(product.title);
  const safeLink = escapeHtml(affiliateLink);
  return `${safeTitle} por <strong>R$${price}</strong> — confira: <a href="${safeLink}">${safeLink}</a>`;
}
