import { afterEach, describe, expect, it, vi } from 'vitest';

const { saveTikTokTokensMock } = vi.hoisted(() => ({ saveTikTokTokensMock: vi.fn() }));

vi.mock('@/lib/social/tiktokTokenStore', () => ({ saveTikTokTokens: saveTikTokTokensMock }));

import { GET } from './route';

function stubEnv() {
  vi.stubEnv('TIKTOK_CLIENT_KEY', 'fake-client-key');
  vi.stubEnv('TIKTOK_CLIENT_SECRET', 'fake-client-secret');
  vi.stubEnv('TIKTOK_REDIRECT_URI', 'https://promopost.example.com/api/tiktok-oauth-callback');
}

describe('GET /api/tiktok-oauth-callback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('troca o código pelo token e salva, retornando sucesso', async () => {
    stubEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'act123',
          refresh_token: 'rft456',
          expires_in: 86400,
        }),
      }),
    );

    const request = new Request('https://promopost.example.com/api/tiktok-oauth-callback?code=abc123');
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(saveTikTokTokensMock).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'act123', refreshToken: 'rft456' }),
    );
  });

  it('retorna 400 quando a TikTok manda erro em vez de código', async () => {
    stubEnv();
    const request = new Request(
      'https://promopost.example.com/api/tiktok-oauth-callback?error=access_denied',
    );
    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(saveTikTokTokensMock).not.toHaveBeenCalled();
  });

  it('retorna 400 quando falta o parâmetro code', async () => {
    stubEnv();
    const request = new Request('https://promopost.example.com/api/tiktok-oauth-callback');
    const response = await GET(request);

    expect(response.status).toBe(400);
  });

  it('retorna 500 quando a troca de código por token falha', async () => {
    stubEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'invalid_grant', error_description: 'Código inválido' }),
      }),
    );

    const request = new Request('https://promopost.example.com/api/tiktok-oauth-callback?code=abc123');
    const response = await GET(request);

    expect(response.status).toBe(500);
    expect(saveTikTokTokensMock).not.toHaveBeenCalled();
  });
});
