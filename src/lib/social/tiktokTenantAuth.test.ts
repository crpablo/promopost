import { afterEach, describe, expect, it, vi } from 'vitest';

const { getTikTokAccountForBusinessMock, saveTikTokAccountForBusinessMock } = vi.hoisted(() => ({
  getTikTokAccountForBusinessMock: vi.fn(),
  saveTikTokAccountForBusinessMock: vi.fn(),
}));

vi.mock('@/lib/db/tiktokAccounts', () => ({
  getTikTokAccountForBusiness: getTikTokAccountForBusinessMock,
  saveTikTokAccountForBusiness: saveTikTokAccountForBusinessMock,
}));

import { getValidAccessTokenForBusiness } from './tiktokTenantAuth';

function stubEnv() {
  vi.stubEnv('TIKTOK_CLIENT_KEY', 'fake-client-key');
  vi.stubEnv('TIKTOK_CLIENT_SECRET', 'fake-client-secret');
}

const POOL = {} as unknown as import('pg').Pool;

describe('getValidAccessTokenForBusiness', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('lança erro quando a empresa não tem conta TikTok conectada', async () => {
    getTikTokAccountForBusinessMock.mockResolvedValue(null);

    await expect(getValidAccessTokenForBusiness(POOL, 'biz-1')).rejects.toThrow(
      'Conta do TikTok não conectada',
    );
  });

  it('retorna o token salvo, sem renovar, quando ele ainda não está perto de expirar', async () => {
    getTikTokAccountForBusinessMock.mockResolvedValue({
      businessId: 'biz-1',
      accessToken: 'valid-access-token',
      refreshToken: 'valid-refresh-token',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // expira em 1h
      connectedAt: new Date(),
    });

    const token = await getValidAccessTokenForBusiness(POOL, 'biz-1');

    expect(token).toBe('valid-access-token');
    expect(saveTikTokAccountForBusinessMock).not.toHaveBeenCalled();
  });

  it('renova o token e persiste quando ele está perto de expirar', async () => {
    stubEnv();
    getTikTokAccountForBusinessMock.mockResolvedValue({
      businessId: 'biz-1',
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: new Date(Date.now() + 60 * 1000), // expira em 1min — precisa renovar
      connectedAt: new Date(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 86400,
        }),
      }),
    );

    const token = await getValidAccessTokenForBusiness(POOL, 'biz-1');

    expect(token).toBe('new-access-token');
    expect(saveTikTokAccountForBusinessMock).toHaveBeenCalledWith(POOL, 'biz-1', {
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: expect.any(Date),
    });
  });

  it('lança erro quando a renovação falha (ex: refresh token revogado)', async () => {
    stubEnv();
    getTikTokAccountForBusinessMock.mockResolvedValue({
      businessId: 'biz-1',
      accessToken: 'old-access-token',
      refreshToken: 'revoked-refresh-token',
      expiresAt: new Date(Date.now() - 1000), // já expirado
      connectedAt: new Date(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'invalid_grant', error_description: 'Refresh token revogado' }),
      }),
    );

    await expect(getValidAccessTokenForBusiness(POOL, 'biz-1')).rejects.toThrow(
      'Falha ao renovar token do TikTok',
    );
  });
});
