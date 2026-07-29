import type { PromoExtraction as PromoExtractionResult } from './extractPromo';

export interface TelegramMessage {
  id: number;
  text: string;
}

export type { PromoExtractionResult };

export interface WebhookCallResult {
  ok: boolean;
  status: number;
}

export interface PollerDeps {
  fetchNewMessages: (afterId: number | null) => Promise<TelegramMessage[]>;
  getLatestMessageId: () => Promise<number | null>;
  loadCursor: () => Promise<number | null>;
  saveCursor: (messageId: number) => Promise<void>;
  extractPromo: (text: string) => Promise<PromoExtractionResult>;
  callWebhook: (body: {
    link: string;
    coupon?: string;
    discountedPrice?: number;
  }) => Promise<WebhookCallResult>;
  acquireLock: () => Promise<boolean>;
  releaseLock: () => Promise<void>;
  batchLimit?: number;
}

export interface PollResult {
  processedCount: number;
  promoCount: number;
  errors: Array<{ messageId: number; error: string; text: string }>;
  skippedConcurrent?: boolean;
}

// Cada chamada ao webhook pode levar até ~65s (Playwright + LLM); um lote
// maior arrisca estourar o maxDuration de 300s ou sobrepor com a próxima
// execução do cron (~3min).
const DEFAULT_BATCH_LIMIT = 3;

/**
 * Salva o cursor, registrando um erro (com o texto da mensagem) se falhar.
 * Retorna false quando a gravação falhou — nesse caso o chamador deve parar
 * o processamento do lote, já que o estado do cursor ficou incerto.
 */
async function saveCursorOrRecordError(
  deps: PollerDeps,
  message: TelegramMessage,
  errors: Array<{ messageId: number; error: string; text: string }>,
): Promise<boolean> {
  try {
    await deps.saveCursor(message.id);
    return true;
  } catch (err) {
    errors.push({ messageId: message.id, error: (err as Error).message, text: message.text });
    return false;
  }
}

export async function pollTelegram(deps: PollerDeps): Promise<PollResult> {
  const locked = await deps.acquireLock();
  if (!locked) {
    return { processedCount: 0, promoCount: 0, errors: [], skippedConcurrent: true };
  }

  try {
    return await runPoll(deps);
  } finally {
    await deps.releaseLock();
  }
}

async function runPoll(deps: PollerDeps): Promise<PollResult> {
  const cursor = await deps.loadCursor();
  if (cursor === null) {
    const latestId = await deps.getLatestMessageId();
    if (latestId !== null) {
      await deps.saveCursor(latestId);
    }
    return { processedCount: 0, promoCount: 0, errors: [] };
  }

  const allMessages = await deps.fetchNewMessages(cursor);
  const batchLimit = deps.batchLimit ?? DEFAULT_BATCH_LIMIT;
  const messages = allMessages.slice(0, batchLimit);

  let promoCount = 0;
  let processedCount = 0;
  const errors: Array<{ messageId: number; error: string; text: string }> = [];

  for (const message of messages) {
    processedCount += 1;

    let extraction: PromoExtractionResult;
    try {
      extraction = await deps.extractPromo(message.text);
    } catch (err) {
      errors.push({
        messageId: message.id,
        error: `Falha na extração: ${(err as Error).message}`,
        text: message.text,
      });
      if (!(await saveCursorOrRecordError(deps, message, errors))) {
        break;
      }
      continue;
    }

    if (!extraction.isMercadoLivrePromo || !extraction.link) {
      if (!(await saveCursorOrRecordError(deps, message, errors))) {
        break;
      }
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
        errors.push({
          messageId: message.id,
          error: `Webhook retornou status ${result.status}`,
          text: message.text,
        });
      }
    } catch (err) {
      errors.push({
        messageId: message.id,
        error: `Falha ao chamar webhook: ${(err as Error).message}`,
        text: message.text,
      });
    }

    if (!(await saveCursorOrRecordError(deps, message, errors))) {
      break;
    }
  }

  return { processedCount, promoCount, errors };
}
