import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage/localStore', () => ({ readBufferFile: vi.fn() }));

import { readBufferFile } from '@/lib/storage/localStore';
import { GET } from './route';

describe('GET /api/telegram-media', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 400 quando falta o parâmetro id', async () => {
    const request = new Request('https://promopost.example.com/api/telegram-media');
    const response = await GET(request);

    expect(response.status).toBe(400);
  });

  it('retorna 400 quando id não é um inteiro positivo', async () => {
    const request = new Request('https://promopost.example.com/api/telegram-media?id=abc');
    const response = await GET(request);

    expect(response.status).toBe(400);
  });

  it('retorna 404 quando o arquivo não existe', async () => {
    vi.mocked(readBufferFile).mockResolvedValue(null);

    const request = new Request('https://promopost.example.com/api/telegram-media?id=123');
    const response = await GET(request);

    expect(response.status).toBe(404);
  });

  it('retorna 200 com content-type image/jpeg quando o arquivo existe', async () => {
    vi.mocked(readBufferFile).mockResolvedValue(Buffer.from([1, 2, 3]));

    const request = new Request('https://promopost.example.com/api/telegram-media?id=123');
    const response = await GET(request);
    const body = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(body).toEqual(new Uint8Array([1, 2, 3]));
    expect(readBufferFile).toHaveBeenCalledWith('telegram-media/123.jpg');
  });
});
