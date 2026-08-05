import { describe, expect, it, vi } from 'vitest';
import { pollTelegram, type PollerDeps } from './poller';

function makeDeps(overrides: Partial<PollerDeps> = {}): PollerDeps {
  return {
    fetchNewMessages: vi.fn().mockResolvedValue([]),
    getLatestMessageId: vi.fn().mockResolvedValue(999),
    loadCursor: vi.fn().mockResolvedValue(999),
    saveCursor: vi.fn().mockResolvedValue(undefined),
    extractPromo: vi.fn().mockResolvedValue({
      isPromo: false,
      link: null,
      coupon: null,
      discountedPrice: null,
    }),
    callWebhook: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    downloadMessagePhoto: vi.fn().mockResolvedValue(null),
    acquireLock: vi.fn().mockResolvedValue(true),
    releaseLock: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('pollTelegram', () => {
  it('não processa nada quando não há mensagens novas', async () => {
    const deps = makeDeps();

    const result = await pollTelegram(deps);

    expect(result).toEqual({ processedCount: 0, promoCount: 0, errors: [] });
    expect(deps.saveCursor).not.toHaveBeenCalled();
  });

  it('ignora mensagem que não é promo de nenhum marketplace suportado, mas avança o cursor', async () => {
    const deps = makeDeps({
      fetchNewMessages: vi.fn().mockResolvedValue([{ id: 10, text: 'bom dia pessoal' }]),
    });

    const result = await pollTelegram(deps);

    expect(result.promoCount).toBe(0);
    expect(result.processedCount).toBe(1);
    expect(deps.callWebhook).not.toHaveBeenCalled();
    expect(deps.saveCursor).toHaveBeenCalledWith(10);
  });

  it('chama o webhook e conta como promo quando a mensagem é reconhecida', async () => {
    const deps = makeDeps({
      fetchNewMessages: vi.fn().mockResolvedValue([{ id: 11, text: 'promo boa' }]),
      extractPromo: vi.fn().mockResolvedValue({
        isPromo: true,
        link: 'https://www.mercadolivre.com.br/produto/p/MLB1',
        coupon: 'PROMO10',
        discountedPrice: 79.9,
      }),
    });

    const result = await pollTelegram(deps);

    expect(result.promoCount).toBe(1);
    expect(deps.callWebhook).toHaveBeenCalledWith({
      link: 'https://www.mercadolivre.com.br/produto/p/MLB1',
      coupon: 'PROMO10',
      discountedPrice: 79.9,
    });
    expect(deps.saveCursor).toHaveBeenCalledWith(11);
  });

  it('chama o webhook e conta como promo quando a mensagem é uma promo da Shopee', async () => {
    const deps = makeDeps({
      fetchNewMessages: vi.fn().mockResolvedValue([{ id: 14, text: 'promo shopee' }]),
      extractPromo: vi.fn().mockResolvedValue({
        isPromo: true,
        link: 'https://shopee.com.br/product/123456/789',
        coupon: null,
        discountedPrice: 45.5,
      }),
    });

    const result = await pollTelegram(deps);

    expect(result.promoCount).toBe(1);
    expect(deps.callWebhook).toHaveBeenCalledWith({
      link: 'https://shopee.com.br/product/123456/789',
      discountedPrice: 45.5,
    });
    expect(deps.saveCursor).toHaveBeenCalledWith(14);
  });

  it('registra erro e avança o cursor mesmo assim quando a extração falha', async () => {
    const deps = makeDeps({
      fetchNewMessages: vi.fn().mockResolvedValue([{ id: 12, text: 'x' }]),
      extractPromo: vi.fn().mockRejectedValue(new Error('LLM indisponível')),
    });

    const result = await pollTelegram(deps);

    expect(result.errors).toEqual([
      { messageId: 12, error: 'Falha na extração: LLM indisponível', text: 'x' },
    ]);
    expect(deps.saveCursor).toHaveBeenCalledWith(12);
  });

  it('registra erro e avança o cursor mesmo assim quando o webhook falha', async () => {
    const deps = makeDeps({
      fetchNewMessages: vi.fn().mockResolvedValue([{ id: 13, text: 'promo' }]),
      extractPromo: vi.fn().mockResolvedValue({
        isPromo: true,
        link: 'https://www.mercadolivre.com.br/produto/p/MLB2',
        coupon: null,
        discountedPrice: null,
      }),
      callWebhook: vi.fn().mockResolvedValue({ ok: false, status: 502 }),
    });

    const result = await pollTelegram(deps);

    expect(result.promoCount).toBe(0);
    expect(result.errors).toEqual([
      { messageId: 13, error: 'Webhook retornou status 502', text: 'promo' },
    ]);
    expect(deps.saveCursor).toHaveBeenCalledWith(13);
  });

  it('respeita o batchLimit, processando só as primeiras N mensagens', async () => {
    const messages = [1, 2, 3].map((id) => ({ id, text: `msg ${id}` }));
    const deps = makeDeps({
      fetchNewMessages: vi.fn().mockResolvedValue(messages),
      batchLimit: 2,
    });

    const result = await pollTelegram(deps);

    expect(result.processedCount).toBe(2);
    expect(deps.saveCursor).toHaveBeenCalledTimes(2);
  });

  it('passa o cursor carregado como afterId pro fetchNewMessages', async () => {
    const deps = makeDeps({ loadCursor: vi.fn().mockResolvedValue(999) });

    await pollTelegram(deps);

    expect(deps.fetchNewMessages).toHaveBeenCalledWith(999);
  });

  describe('primeira execução (cursor nulo)', () => {
    it('semeia o cursor com a mensagem mais recente sem processar nada, quando getLatestMessageId retorna um id', async () => {
      const deps = makeDeps({
        loadCursor: vi.fn().mockResolvedValue(null),
        getLatestMessageId: vi.fn().mockResolvedValue(500),
      });

      const result = await pollTelegram(deps);

      expect(deps.saveCursor).toHaveBeenCalledWith(500);
      expect(deps.saveCursor).toHaveBeenCalledTimes(1);
      expect(deps.fetchNewMessages).not.toHaveBeenCalled();
      expect(deps.extractPromo).not.toHaveBeenCalled();
      expect(deps.callWebhook).not.toHaveBeenCalled();
      expect(result).toEqual({ processedCount: 0, promoCount: 0, errors: [] });
    });

    it('não salva cursor quando getLatestMessageId também retorna null (canal vazio)', async () => {
      const deps = makeDeps({
        loadCursor: vi.fn().mockResolvedValue(null),
        getLatestMessageId: vi.fn().mockResolvedValue(null),
      });

      const result = await pollTelegram(deps);

      expect(deps.saveCursor).not.toHaveBeenCalled();
      expect(deps.fetchNewMessages).not.toHaveBeenCalled();
      expect(result).toEqual({ processedCount: 0, promoCount: 0, errors: [] });
    });
  });

  describe('lock contra execuções concorrentes', () => {
    it('não processa nada e sinaliza skippedConcurrent quando já existe outra execução travando', async () => {
      const deps = makeDeps({
        acquireLock: vi.fn().mockResolvedValue(false),
        fetchNewMessages: vi.fn().mockResolvedValue([{ id: 1, text: 'promo' }]),
      });

      const result = await pollTelegram(deps);

      expect(result).toEqual({ processedCount: 0, promoCount: 0, errors: [], skippedConcurrent: true });
      expect(deps.loadCursor).not.toHaveBeenCalled();
      expect(deps.fetchNewMessages).not.toHaveBeenCalled();
      expect(deps.releaseLock).not.toHaveBeenCalled();
    });

    it('libera o lock ao final mesmo quando o processamento é bem-sucedido', async () => {
      const deps = makeDeps({
        fetchNewMessages: vi.fn().mockResolvedValue([{ id: 1, text: 'bom dia' }]),
      });

      await pollTelegram(deps);

      expect(deps.releaseLock).toHaveBeenCalledTimes(1);
    });

    it('libera o lock mesmo quando o processamento lança um erro inesperado', async () => {
      const deps = makeDeps({
        loadCursor: vi.fn().mockRejectedValue(new Error('falha inesperada')),
      });

      await expect(pollTelegram(deps)).rejects.toThrow('falha inesperada');
      expect(deps.releaseLock).toHaveBeenCalledTimes(1);
    });
  });

  describe('falha ao salvar o cursor', () => {
    it('para o lote imediatamente quando saveCursor falha na primeira mensagem, sem processar as seguintes', async () => {
      const messages = [1, 2, 3].map((id) => ({ id, text: `msg ${id}` }));
      const extractPromo = vi.fn().mockResolvedValue({
        isPromo: false,
        link: null,
        coupon: null,
        discountedPrice: null,
      });
      const deps = makeDeps({
        fetchNewMessages: vi.fn().mockResolvedValue(messages),
        extractPromo,
        saveCursor: vi.fn().mockRejectedValue(new Error('Falha ao salvar cursor do Telegram: 500')),
      });

      const result = await pollTelegram(deps);

      expect(extractPromo).toHaveBeenCalledTimes(1);
      expect(result.processedCount).toBe(1);
      expect(result.errors).toEqual([
        { messageId: 1, error: 'Falha ao salvar cursor do Telegram: 500', text: 'msg 1' },
      ]);
    });
  });

  it('repassa discountPercent, minPurchaseValue e maxDiscountValue pro callWebhook quando presentes', async () => {
    const deps = makeDeps({
      fetchNewMessages: vi.fn().mockResolvedValue([{ id: 12, text: 'cupom de lista' }]),
      extractPromo: vi.fn().mockResolvedValue({
        isPromo: true,
        link: 'https://www.mercadolivre.com.br/social/promozonevip/lists',
        coupon: 'LIVROSJOGOSRELAMPAGO',
        discountedPrice: null,
        discountPercent: 20,
        minPurchaseValue: 59,
        maxDiscountValue: 30,
      }),
    });

    await pollTelegram(deps);

    expect(deps.callWebhook).toHaveBeenCalledWith({
      link: 'https://www.mercadolivre.com.br/social/promozonevip/lists',
      coupon: 'LIVROSJOGOSRELAMPAGO',
      discountedPrice: undefined,
      discountPercent: 20,
      minPurchaseValue: 59,
      maxDiscountValue: 30,
    });
  });

  it('baixa a foto e repassa title/originalPrice/photoUrl quando o link é do Magalu', async () => {
    const deps = makeDeps({
      fetchNewMessages: vi.fn().mockResolvedValue([{ id: 55, text: 'promo magalu' }]),
      extractPromo: vi.fn().mockResolvedValue({
        isPromo: true,
        link: 'https://www.magazineluiza.com.br/produto-x/p/abc123/',
        coupon: null,
        discountedPrice: 89.9,
        title: 'Carregador Portátil',
        originalPrice: 129.9,
      }),
      downloadMessagePhoto: vi.fn().mockResolvedValue('https://promopost.example.com/api/telegram-media?id=55'),
    });

    await pollTelegram(deps);

    expect(deps.downloadMessagePhoto).toHaveBeenCalledWith(55);
    expect(deps.callWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Carregador Portátil',
        originalPrice: 129.9,
        photoUrl: 'https://promopost.example.com/api/telegram-media?id=55',
      }),
    );
  });

  it('não baixa foto quando o link não é do Magalu', async () => {
    const deps = makeDeps({
      fetchNewMessages: vi.fn().mockResolvedValue([{ id: 56, text: 'promo ML' }]),
      extractPromo: vi.fn().mockResolvedValue({
        isPromo: true,
        link: 'https://www.mercadolivre.com.br/produto/p/MLB123',
        coupon: null,
        discountedPrice: null,
        title: null,
        originalPrice: null,
      }),
    });

    await pollTelegram(deps);

    expect(deps.downloadMessagePhoto).not.toHaveBeenCalled();
  });
});
