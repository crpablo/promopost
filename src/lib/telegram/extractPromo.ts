import { generateObject } from 'ai';
import { groq } from '@ai-sdk/groq';
import { z } from 'zod';

const PromoSchema = z.object({
  isPromo: z.boolean(),
  link: z.string().nullable(),
  coupon: z.string().nullable(),
  discountedPrice: z.number().nullable(),
});

export interface PromoExtraction {
  isPromo: boolean;
  link: string | null;
  coupon: string | null;
  discountedPrice: number | null;
}

const EXTRACTOR_MODEL_ID = process.env.PROMO_EXTRACTOR_MODEL ?? 'openai/gpt-oss-20b';

const PROMPT_INSTRUCTIONS = `Você recebe o texto de uma mensagem de um grupo de promoções de compras online.

Decida se a mensagem é uma promoção de um produto do Mercado Livre (mercadolivre.com.br ou mercadolibre.com), da Shopee (shopee.com.br) ou da Amazon (amazon.com.br), incluindo links de encurtador/rastreador que podem levar pra lá — nesse caso ainda assim considere como possível promo válida e devolva o link como veio na mensagem.

Se for uma promoção do Mercado Livre, da Shopee ou da Amazon, extraia:
- link: a URL do produto (ou do encurtador) exatamente como aparece na mensagem.
- coupon: o código do cupom de desconto, se a mensagem mencionar um. Caso contrário, null. Independente de haver preço com desconto ou não.
- discountedPrice: o preço final de venda mencionado na mensagem (o valor "por", não o valor "de"), como número (ex: 89.90) — sempre que a mensagem deixar claro esse valor, com ou sem cupom (pode ser um desconto direto, sem código nenhum). Se a mensagem não deixar claro um preço final específico, use null.

Se a mensagem não for sobre uma promoção do Mercado Livre, da Shopee nem da Amazon (ex: é conversa comum, ou é promoção de outro site/marketplace), retorne isPromo: false e os demais campos null.`;

export async function extractPromo(messageText: string): Promise<PromoExtraction> {
  const { object } = await generateObject({
    model: groq(EXTRACTOR_MODEL_ID),
    schema: PromoSchema,
    prompt: `${PROMPT_INSTRUCTIONS}\n\nMensagem:\n"""\n${messageText}\n"""`,
  });
  return object;
}
