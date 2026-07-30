import { afterEach, describe, expect, it, vi } from 'vitest';

const { loadTikTokTokensMock, saveTikTokTokensMock } = vi.hoisted(() => ({
  loadTikTokTokensMock: vi.fn(),
  saveTikTokTokensMock: vi.fn(),
}));

// Mock parcial: mantém exchangeTikTokToken real (usa o fetch stub de cada
// teste) e só substitui load/save, que é o que os testes precisam controlar.
vi.mock('@/lib/social/tiktokTokenStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/social/tiktokTokenStore')>();
  return {
    ...actual,
    loadTikTokTokens: loadTikTokTokensMock,
    saveTikTokTokens: saveTikTokTokensMock,
  };
});

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
    loadTikTokTokensMock.mockResolvedValue(null); // sem token salvo ainda — permite a troca
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
    loadTikTokTokensMock.mockResolvedValue(null);
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

  it('retorna 500 quando a resposta da TikTok vem 200 mas sem refresh_token (evita corromper o token store)', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue(null);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'act123', expires_in: 86400 }), // sem refresh_token
      }),
    );

    const request = new Request('https://promopost.example.com/api/tiktok-oauth-callback?code=abc123');
    const response = await GET(request);

    expect(response.status).toBe(500);
    expect(saveTikTokTokensMock).not.toHaveBeenCalled();
  });

  it('retorna 409 e não sobrescreve quando já existe uma conta autorizada', async () => {
    stubEnv();
    loadTikTokTokensMock.mockResolvedValue({
      accessToken: 'existing-access-token',
      refreshToken: 'existing-refresh-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request('https://promopost.example.com/api/tiktok-oauth-callback?code=abc123');
    const response = await GET(request);
    const body = await response.text();

    expect(response.status).toBe(409);
    expect(body).toContain('Já existe uma conta do TikTok autorizada');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saveTikTokTokensMock).not.toHaveBeenCalled();
  });
});
