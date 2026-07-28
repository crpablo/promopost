import { generateObject } from 'ai';
import { z } from 'zod';

const PromoSchema = z.object({
  isMercadoLivrePromo: z.boolean(),
  link: z.string().nullable(),
  coupon: z.string().nullable(),
  discountedPrice: z.number().nullable(),
});

export interface PromoExtraction {
  isMercadoLivrePromo: boolean;
  link: string | null;
  coupon: string | null;
  discountedPrice: number | null;
}

const EXTRACTOR_MODEL = process.env.PROMO_EXTRACTOR_MODEL ?? 'openai/gpt-4o-mini';

const PROMPT_INSTRUCTIONS = `Você recebe o texto de uma mensagem de um grupo de promoções de compras online.

Decida se a mensagem é uma promoção de um produto do Mercado Livre (mercadolivre.com.br ou mercadolibre.com, incluindo links de encurtador/rastreador que podem levar pra lá — nesse caso ainda assim considere como possível promo do Mercado Livre e devolva o link como veio na mensagem).

Se for uma promoção do Mercado Livre, extraia:
- link: a URL do produto (ou do encurtador) exatamente como aparece na mensagem.
- coupon: o código do cupom de desconto, se a mensagem mencionar um. Caso contrário, null.
- discountedPrice: o preço final já com o cupom aplicado (o valor "por", não o valor "de"), como número (ex: 89.90). Se a mensagem não mencionar cupom ou não deixar claro o preço com desconto, use null.

Se a mensagem não for sobre uma promoção do Mercado Livre (ex: é conversa comum, ou é promoção de outro site/marketplace), retorne isMercadoLivrePromo: false e os demais campos null.`;

export async function extractPromo(messageText: string): Promise<PromoExtraction> {
  const { object } = await generateObject({
    model: EXTRACTOR_MODEL,
    schema: PromoSchema,
    prompt: `${PROMPT_INSTRUCTIONS}\n\nMensagem:\n"""\n${messageText}\n"""`,
  });
  return object;
}
