export interface TelegramMessage {
  id: number;
  text: string;
}

export interface PromoExtractionResult {
  isMercadoLivrePromo: boolean;
  link: string | null;
  coupon: string | null;
  discountedPrice: number | null;
}

export interface WebhookCallResult {
  ok: boolean;
  status: number;
}

export interface PollerDeps {
  fetchNewMessages: (afterId: number | null) => Promise<TelegramMessage[]>;
  loadCursor: () => Promise<number | null>;
  saveCursor: (messageId: number) => Promise<void>;
  extractPromo: (text: string) => Promise<PromoExtractionResult>;
  callWebhook: (body: {
    link: string;
    coupon?: string;
    discountedPrice?: number;
  }) => Promise<WebhookCallResult>;
  batchLimit?: number;
}

export interface PollResult {
  processedCount: number;
  promoCount: number;
  errors: Array<{ messageId: number; error: string }>;
}

const DEFAULT_BATCH_LIMIT = 5;

export async function pollTelegram(deps: PollerDeps): Promise<PollResult> {
  const cursor = await deps.loadCursor();
  const allMessages = await deps.fetchNewMessages(cursor);
  const batchLimit = deps.batchLimit ?? DEFAULT_BATCH_LIMIT;
  const messages = allMessages.slice(0, batchLimit);

  let promoCount = 0;
  const errors: Array<{ messageId: number; error: string }> = [];

  for (const message of messages) {
    let extraction: PromoExtractionResult;
    try {
      extraction = await deps.extractPromo(message.text);
    } catch (err) {
      errors.push({ messageId: message.id, error: `Falha na extração: ${(err as Error).message}` });
      await deps.saveCursor(message.id);
      continue;
    }

    if (!extraction.isMercadoLivrePromo || !extraction.link) {
      await deps.saveCursor(message.id);
      continue;
    }

    try {
      const result = await deps.callWebhook({
        link: extraction.link,
        coupon: extraction.coupon ?? undefined,
        discountedPrice: extraction.discountedPrice ?? undefined,
      });
      if (result.ok) {
        promoCount += 1;
      } else {
        errors.push({ messageId: message.id, error: `Webhook retornou status ${result.status}` });
      }
    } catch (err) {
      errors.push({ messageId: message.id, error: `Falha ao chamar webhook: ${(err as Error).message}` });
    }

    await deps.saveCursor(message.id);
  }

  return { processedCount: messages.length, promoCount, errors };
}
