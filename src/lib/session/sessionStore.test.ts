import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSession } from './sessionStore';

describe('loadSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('baixa a sessão da url configurada usando o token como bearer', async () => {
    vi.stubEnv('ML_SESSION_BLOB_URL', 'https://blob.vercel-storage.com/ml-session-abc.json');
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'fake-token');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('{"cookies":[]}').buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    const buffer = await loadSession();

    expect(fetchMock).toHaveBeenCalledWith('https://blob.vercel-storage.com/ml-session-abc.json', {
      headers: { authorization: 'Bearer fake-token' },
    });
    expect(buffer.toString()).toBe('{"cookies":[]}');
  });

  it('lança erro quando ML_SESSION_BLOB_URL não está configurada', async () => {
    vi.stubEnv('ML_SESSION_BLOB_URL', '');
    await expect(loadSession()).rejects.toThrow('ML_SESSION_BLOB_URL não configurada');
  });
});
