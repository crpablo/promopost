import { escapeHtml } from './template';

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export interface CouponDetails {
  coupon: string;
  affiliateLink: string;
  discountPercent?: number;
  minPurchaseValue?: number;
  maxDiscountValue?: number;
}

function buildMinPurchasePart(details: CouponDetails): string {
  return typeof details.minPurchaseValue === 'number'
    ? ` em compras acima de R$${formatPrice(details.minPurchaseValue)}`
    : '';
}

function buildStandaloneMinPurchaseLine(details: CouponDetails): string | null {
  return typeof details.minPurchaseValue === 'number'
    ? `Em compras acima de R$${formatPrice(details.minPurchaseValue)}`
    : null;
}

export function buildCouponCaption(details: CouponDetails): string {
  const lines: string[] = [`🎟️ Cupom Mercado Livre: ${details.coupon}`];

  if (typeof details.discountPercent === 'number') {
    lines.push(`🔥 ${details.discountPercent}% OFF${buildMinPurchasePart(details)}`);
  } else {
    const minPurchaseLine = buildStandaloneMinPurchaseLine(details);
    if (minPurchaseLine) {
      lines.push(`📦 ${minPurchaseLine}`);
    }
  }

  if (typeof details.maxDiscountValue === 'number') {
    lines.push(`💰 Desconto máximo de R$${formatPrice(details.maxDiscountValue)}`);
  }

  lines.push(`🔗 Ative: ${details.affiliateLink}`);
  lines.push('#promocao #cupom #mercadolivre');

  return lines.join('\n\n');
}

export function buildCouponArticleText(details: CouponDetails): { title: string; body: string } {
  const minPurchasePart = buildMinPurchasePart(details);
  const titleSuffix =
    typeof details.discountPercent === 'number' ? `${details.discountPercent}% OFF${minPurchasePart}` : details.coupon;
  const title = `Cupom Mercado Livre: ${titleSuffix}`.slice(0, 255);

  const bodyLines: string[] = [`Cupom: <strong>${escapeHtml(details.coupon)}</strong>`];
  if (typeof details.discountPercent === 'number') {
    bodyLines.push(`${details.discountPercent}% OFF${minPurchasePart}`);
  } else {
    const minPurchaseLine = buildStandaloneMinPurchaseLine(details);
    if (minPurchaseLine) {
      bodyLines.push(minPurchaseLine);
    }
  }
  if (typeof details.maxDiscountValue === 'number') {
    bodyLines.push(`Desconto máximo de R$${formatPrice(details.maxDiscountValue)}`);
  }
  bodyLines.push(`<a href="${escapeHtml(details.affiliateLink)}">Ative o cupom</a>`);

  return { title, body: bodyLines.join('<br><br>') };
}
