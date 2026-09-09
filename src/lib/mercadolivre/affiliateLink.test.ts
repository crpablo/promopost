import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('../session/sessionStore', () => ({
  loadSession: vi.fn().mockResolvedValue(Buffer.from('{"cookies":[]}')),
}));

import { fetchProductAndAffiliateLink, runScript } from './affiliateLink';

const FAKE_PID = 4242;

// Simula o child_process real retornado por spawn(): stdout/stderr como
// streams próprios (EventEmitter) e o processo em si emitindo 'close' (ou
// 'error') — mesmo formato que o node:child_process real usa.
function createFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.pid = FAKE_PID;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function mockSpawnSuccess(stdout: string) {
  const child = createFakeChild();
  spawnMock.mockImplementation(() => {
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(stdout));
      child.emit('close', 0);
    });
    return child;
  });
  return child;
}

function mockSpawnFailure(stderr: string) {
  const child = createFakeChild();
  spawnMock.mockImplementation(() => {
    queueMicrotask(() => {
      child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', 1);
    });
    return child;
  });
  return child;
}

// Processo filho que nunca fecha sozinho — usado pra testar o caminho de
// timeout (quem "termina" esse processo é o próprio runScript, matando o
// grupo depois que o timer estoura).
function mockSpawnHangs() {
  const child = createFakeChild();
  spawnMock.mockImplementation(() => child);
  return child;
}

describe('fetchProductAndAffiliateLink', () => {
  beforeEach(() => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('retorna produto e link de afiliado quando o script termina com sucesso', async () => {
    mockSpawnSuccess(
      `${JSON.stringify({
        title: 'Fone de Ouvido Bluetooth XYZ',
        price: 149.9,
        imageUrl: 'https://http2.mlstatic.com/img.jpg',
        marketplace: 'mercadolivre',
        affiliateLink: 'https://meli.la/abc123',
      })}\n`,
    );

    const result = await fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123');

    expect(result).toEqual({
      product: {
        title: 'Fone de Ouvido Bluetooth XYZ',
        price: 149.9,
        imageUrl: 'https://http2.mlstatic.com/img.jpg',
        marketplace: 'mercadolivre',
      },
      affiliateLink: 'https://meli.la/abc123',
    });
    expect(spawnMock).toHaveBeenCalledWith(
      'node',
      expect.arrayContaining([expect.stringContaining('generate-link.playwright.mjs'), 'https://mercadolivre.com.br/MLB123']),
      expect.objectContaining({
        env: expect.objectContaining({ ML_SESSION_PATH: expect.any(String) }),
        detached: true,
      }),
    );
  });

  it('lança SessionExpiredError quando o script reporta SESSION_EXPIRED no stderr', async () => {
    mockSpawnFailure('SESSION_EXPIRED');

    await expect(
      fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123'),
    ).rejects.toThrow('SESSION_EXPIRED');
  });

  it('lança ProductNotFoundError quando o script reporta PRODUCT_NOT_FOUND no stderr', async () => {
    mockSpawnFailure('PRODUCT_NOT_FOUND (title=null, price=null, imageUrl=null)');

    await expect(
      fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123'),
    ).rejects.toThrow('Produto não encontrado');
  });

  it('lança InvalidLinkError quando o script reporta MARKETPLACE_NOT_SUPPORTED no stderr', async () => {
    mockSpawnFailure('MARKETPLACE_NOT_SUPPORTED (resolvido para: https://exemplo.com/outra-coisa)');

    await expect(
      fetchProductAndAffiliateLink('https://go.promozone.ai/mercadolivre/PwQ6x6'),
    ).rejects.toThrow('Link não leva a um marketplace suportado');
  });

  it('lança ListCouponError com o link de afiliado quando o script reporta isListCoupon:true (cupom de lista)', async () => {
    mockSpawnSuccess(
      `${JSON.stringify({
        marketplace: 'mercadolivre',
        affiliateLink: 'https://mercadolivre.com/sec/xyz789',
        isListCoupon: true,
      })}\n`,
    );

    await expect(
      fetchProductAndAffiliateLink('https://www.mercadolivre.com.br/social/promozonevip/lists'),
    ).rejects.toMatchObject({
      name: 'ListCouponError',
      affiliateLink: 'https://mercadolivre.com/sec/xyz789',
    });
  });

  it('lança erro genérico quando isListCoupon:true mas affiliateLink está ausente ou inválido', async () => {
    mockSpawnSuccess(
      `${JSON.stringify({
        marketplace: 'mercadolivre',
        isListCoupon: true,
      })}\n`,
    );

    await expect(
      fetchProductAndAffiliateLink('https://www.mercadolivre.com.br/social/promozonevip/lists'),
    ).rejects.toThrow('Saída inesperada do script de afiliado');
  });

  it('lança erro genérico quando o script falha por outro motivo', async () => {
    mockSpawnFailure('TimeoutError: locator not found');

    await expect(
      fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123'),
    ).rejects.toThrow('Falha ao gerar link de afiliado');
  });

  it('lança erro quando a saída não é um JSON válido', async () => {
    mockSpawnSuccess('not json');

    await expect(
      fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123'),
    ).rejects.toThrow('Saída inesperada do script de afiliado');
  });

  it('retorna produto da Amazon com marketplace correto quando o script termina com sucesso', async () => {
    mockSpawnSuccess(
      `${JSON.stringify({
        title: 'Fone Bluetooth Amazon',
        price: 129.9,
        imageUrl: 'https://m.media-amazon.com/images/I/abc.jpg',
        marketplace: 'amazon',
        affiliateLink: 'https://www.amazon.com.br/dp/B08XYZ?tag=crpablo0d-20',
      })}\n`,
    );

    const result = await fetchProductAndAffiliateLink('https://www.amazon.com.br/dp/B08XYZ');

    expect(result.product.marketplace).toBe('amazon');
  });

  it('lança erro quando o script reporta AMAZON_CREDENTIALS_MISSING no stderr', async () => {
    mockSpawnFailure('AMAZON_CREDENTIALS_MISSING');

    await expect(
      fetchProductAndAffiliateLink('https://www.amazon.com.br/dp/B08XYZ'),
    ).rejects.toThrow('Variáveis de ambiente da Amazon ausentes');
  });

  it('passa AMAZON_ASSOCIATE_TAG como env var pro processo filho', async () => {
    vi.stubEnv('AMAZON_ASSOCIATE_TAG', 'crpablo0d-20');
    mockSpawnSuccess(
      `${JSON.stringify({
        title: 'Produto',
        price: 10,
        imageUrl: 'https://m.media-amazon.com/images/I/x.jpg',
        marketplace: 'amazon',
        affiliateLink: 'https://www.amazon.com.br/dp/X?tag=crpablo0d-20',
      })}\n`,
    );

    await fetchProductAndAffiliateLink('https://www.amazon.com.br/dp/X');

    expect(spawnMock).toHaveBeenCalledWith(
      'node',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ AMAZON_ASSOCIATE_TAG: 'crpablo0d-20' }),
      }),
    );
  });

  it('mata o grupo de processos do script (node + Chromium) depois que ele termina com sucesso', async () => {
    mockSpawnSuccess(`${JSON.stringify({ title: 't', price: 1, imageUrl: 'https://x/y.jpg', affiliateLink: 'https://meli.la/x' })}\n`);

    await fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123');

    expect(process.kill).toHaveBeenCalledWith(-FAKE_PID, 'SIGKILL');
  });

  it('mata o grupo de processos do script mesmo quando ele termina com erro', async () => {
    mockSpawnFailure('PRODUCT_NOT_FOUND (title=null, price=null, imageUrl=null)');

    await expect(fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123')).rejects.toThrow();

    expect(process.kill).toHaveBeenCalledWith(-FAKE_PID, 'SIGKILL');
  });

  it('mata o grupo de processos e rejeita quando o script estoura o timeout sem terminar', async () => {
    vi.useFakeTimers();
    mockSpawnHangs();

    // Chama runScript direto (não fetchProductAndAffiliateLink) pra não ter
    // I/O real (mkdtemp/writeFile) de permeio antes do timer ser criado —
    // o Promise executor roda o `spawn` + `setTimeout` de forma síncrona,
    // então o fake timer já está registrado assim que essa chamada retorna.
    const resultPromise = runScript('https://mercadolivre.com.br/MLB123', process.env);
    // silencia unhandled rejection warning enquanto o timer não estoura
    resultPromise.catch(() => {});

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);

    await expect(resultPromise).rejects.toThrow();
    expect(process.kill).toHaveBeenCalledWith(-FAKE_PID, 'SIGKILL');
  });

  it('não tenta matar o grupo de processos quando o script nunca recebeu um pid (spawn falhou)', async () => {
    const child = createFakeChild();
    // @ts-expect-error simula spawn() que falha antes de atribuir pid (ENOENT etc)
    child.pid = undefined;
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => child.emit('error', new Error('spawn ENOENT')));
      return child;
    });

    await expect(fetchProductAndAffiliateLink('https://mercadolivre.com.br/MLB123')).rejects.toThrow();

    expect(process.kill).not.toHaveBeenCalled();
  });
});
