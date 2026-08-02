import { afterEach, describe, expect, it, vi } from 'vitest';

const { fileAgeMsMock, writeTextFileMock, deleteFileMock } = vi.hoisted(() => ({
  fileAgeMsMock: vi.fn(),
  writeTextFileMock: vi.fn(),
  deleteFileMock: vi.fn(),
}));

vi.mock('../storage/localStore', () => ({
  fileAgeMs: fileAgeMsMock,
  writeTextFile: writeTextFileMock,
  deleteFile: deleteFileMock,
}));

import { acquireLock, releaseLock } from './lock';

describe('acquireLock', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('trava quando não existe lock nenhum ainda', async () => {
    fileAgeMsMock.mockResolvedValue(null);
    writeTextFileMock.mockResolvedValue(undefined);

    const locked = await acquireLock();

    expect(locked).toBe(true);
    expect(writeTextFileMock).toHaveBeenCalledWith('telegram-poll.lock', expect.any(String));
  });

  it('recusa travar quando já existe um lock recente de outra execução', async () => {
    fileAgeMsMock.mockResolvedValue(10_000);

    const locked = await acquireLock();

    expect(locked).toBe(false);
    expect(writeTextFileMock).not.toHaveBeenCalled();
  });

  it('trava mesmo assim quando o lock existente está velho (execução anterior travou/morreu)', async () => {
    fileAgeMsMock.mockResolvedValue(10 * 60 * 1000);
    writeTextFileMock.mockResolvedValue(undefined);

    const locked = await acquireLock();

    expect(locked).toBe(true);
    expect(writeTextFileMock).toHaveBeenCalled();
  });
});

describe('releaseLock', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('apaga o arquivo de lock', async () => {
    deleteFileMock.mockResolvedValue(undefined);

    await releaseLock();

    expect(deleteFileMock).toHaveBeenCalledWith('telegram-poll.lock');
  });

  it('não lança erro se apagar o lock falhar', async () => {
    deleteFileMock.mockRejectedValue(new Error('disk error'));

    await expect(releaseLock()).resolves.toBeUndefined();
  });
});
