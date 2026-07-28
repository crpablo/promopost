import { describe, expect, it, vi } from 'vitest';
import { pollTelegram, type PollerDeps } from './poller';

function makeDeps(overrides: Partial<PollerDeps> = {}): PollerDeps {
  return {
    fetchNewMessages: vi.fn().mockResolvedValue([]),
    loadCursor: vi.fn().mockResolvedValue(null),
    saveCursor: vi.fn().mockResolvedValue(undefined),
    extractPromo: vi.fn().mockResolvedValue({
      isMercadoLivrePromo: false,
      link: null,
      coupon: null,
      discountedPrice: null,
    }),
    callWebhook: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
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

  it('ignora mensagem que não é promo do Mercado Livre, mas avança o cursor', async () => {
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
        isMercadoLivrePromo: true,
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

  it('registra erro e avança o cursor mesmo assim quando a extração falha', async () => {
    const deps = makeDeps({
      fetchNewMessages: vi.fn().mockResolvedValue([{ id: 12, text: 'x' }]),
      extractPromo: vi.fn().mockRejectedValue(new Error('LLM indisponível')),
    });

    const result = await pollTelegram(deps);

    expect(result.errors).toEqual([{ messageId: 12, error: 'Falha na extração: LLM indisponível' }]);
    expect(deps.saveCursor).toHaveBeenCalledWith(12);
  });

  it('registra erro e avança o cursor mesmo assim quando o webhook falha', async () => {
    const deps = makeDeps({
      fetchNewMessages: vi.fn().mockResolvedValue([{ id: 13, text: 'promo' }]),
      extractPromo: vi.fn().mockResolvedValue({
        isMercadoLivrePromo: true,
        link: 'https://www.mercadolivre.com.br/produto/p/MLB2',
        coupon: null,
        discountedPrice: null,
      }),
      callWebhook: vi.fn().mockResolvedValue({ ok: false, status: 502 }),
    });

    const result = await pollTelegram(deps);

    expect(result.promoCount).toBe(0);
    expect(result.errors).toEqual([{ messageId: 13, error: 'Webhook retornou status 502' }]);
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
});
