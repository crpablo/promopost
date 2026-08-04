import { generateObject } from 'ai';
import { groq } from '@ai-sdk/groq';
import { z } from 'zod';

const PromoSchema = z.object({
  isPromo: z.boolean(),
  link: z.string().nullable(),
  coupon: z.string().nullable(),
  discountedPrice: z.number().nullable(),
  discountPercent: z.number().nullable(),
  minPurchaseValue: z.number().nullable(),
  maxDiscountValue: z.number().nullable(),
});

export interface PromoExtraction {
  isPromo: boolean;
  link: string | null;
  coupon: string | null;
  discountedPrice: number | null;
  discountPercent: number | null;
  minPurchaseValue: number | null;
  maxDiscountValue: number | null;
}

const EXTRACTOR_MODEL_ID = process.env.PROMO_EXTRACTOR_MODEL ?? 'openai/gpt-oss-20b';

const PROMPT_INSTRUCTIONS = `Você recebe o texto de uma mensagem de um grupo de promoções de compras online.

Decida se a mensagem é uma promoção de um produto do Mercado Livre (mercadolivre.com.br ou mercadolibre.com), da Shopee (shopee.com.br), da Amazon (amazon.com.br) ou do Magalu (magazineluiza.com.br), incluindo links de encurtador/rastreador que podem levar pra lá — nesse caso ainda assim considere como possível promo válida e devolva o link como veio na mensagem. Isso inclui cupons de loja ou categoria inteira do Mercado Livre (sem produto único vinculado, com um link pra página de listas do afiliado, ex: mercadolivre.com.br/social/{handle}/lists) — também são promoções válidas.

Se for uma promoção do Mercado Livre, da Shopee, da Amazon ou do Magalu, extraia:
- link: a URL do produto (ou do encurtador, ou da página de listas do afiliado no caso de cupom de loja/categoria inteira) exatamente como aparece na mensagem.
- coupon: o código do cupom de desconto, se a mensagem mencionar um. Caso contrário, null. Independente de haver preço com desconto ou não.
- discountedPrice: o preço final de venda mencionado na mensagem (o valor "por", não o valor "de"), como número (ex: 89.90) — sempre que a mensagem deixar claro esse valor, com ou sem cupom (pode ser um desconto direto, sem código nenhum). Se a mensagem não deixar claro um preço final específico, use null.
- discountPercent: o percentual de desconto do cupom (ex: "20% OFF" → 20), como número, quando a mensagem mencionar um desconto percentual. Se não houver percentual mencionado, use null.
- minPurchaseValue: o valor mínimo de compra pra o cupom valer (ex: "compras acima de R$59,00" → 59), como número. Se não houver valor mínimo mencionado, use null.
- maxDiscountValue: o valor máximo de desconto que o cupom concede (ex: "desconto máximo de R$30" → 30), como número. Se não houver valor máximo mencionado, use null.

Se a mensagem não for sobre uma promoção do Mercado Livre, da Shopee, da Amazon nem do Magalu (ex: é conversa comum, ou é promoção de outro site/marketplace), retorne isPromo: false e os demais campos null.`;

export async function extractPromo(messageText: string): Promise<PromoExtraction> {
  const { object } = await generateObject({
    model: groq(EXTRACTOR_MODEL_ID),
    schema: PromoSchema,
    prompt: `${PROMPT_INSTRUCTIONS}\n\nMensagem:\n"""\n${messageText}\n"""`,
  });
  return object;
}
