import { afterEach, describe, expect, it, vi } from 'vitest';

const { headMock, putMock, delMock } = vi.hoisted(() => ({
  headMock: vi.fn(),
  putMock: vi.fn(),
  delMock: vi.fn(),
}));

vi.mock('@vercel/blob', () => ({
  head: headMock,
  put: putMock,
  del: delMock,
}));

import { acquireLock, releaseLock } from './lock';

describe('acquireLock', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('trava quando não existe lock nenhum ainda', async () => {
    headMock.mockRejectedValue(new Error('not found'));
    putMock.mockResolvedValue({ url: 'https://blob.vercel-storage.com/telegram-poll.lock' });

    const locked = await acquireLock();

    expect(locked).toBe(true);
    expect(putMock).toHaveBeenCalledWith(
      'telegram-poll.lock',
      expect.any(String),
      expect.objectContaining({ access: 'private', allowOverwrite: true }),
    );
  });

  it('recusa travar quando já existe um lock recente de outra execução', async () => {
    headMock.mockResolvedValue({ uploadedAt: new Date(Date.now() - 10_000) });

    const locked = await acquireLock();

    expect(locked).toBe(false);
    expect(putMock).not.toHaveBeenCalled();
  });

  it('trava mesmo assim quando o lock existente está velho (execução anterior travou/morreu)', async () => {
    headMock.mockResolvedValue({ uploadedAt: new Date(Date.now() - 10 * 60 * 1000) });
    putMock.mockResolvedValue({ url: 'https://blob.vercel-storage.com/telegram-poll.lock' });

    const locked = await acquireLock();

    expect(locked).toBe(true);
    expect(putMock).toHaveBeenCalled();
  });
});

describe('releaseLock', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('apaga o blob de lock', async () => {
    delMock.mockResolvedValue(undefined);

    await releaseLock();

    expect(delMock).toHaveBeenCalledWith('telegram-poll.lock', expect.objectContaining({}));
  });

  it('não lança erro se apagar o lock falhar', async () => {
    delMock.mockRejectedValue(new Error('network error'));

    await expect(releaseLock()).resolves.toBeUndefined();
  });
});
