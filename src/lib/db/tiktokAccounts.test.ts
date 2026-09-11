import { describe, expect, it, vi } from 'vitest';
import { getTikTokAccountForBusiness, saveTikTokAccountForBusiness } from './tiktokAccounts';

function makePool(rows: unknown[]) {
  return { query: vi.fn().mockResolvedValue({ rows }) } as unknown as import('pg').Pool;
}

describe('getTikTokAccountForBusiness', () => {
  it('retorna null quando a empresa não tem conta TikTok conectada', async () => {
    const pool = makePool([]);
    const result = await getTikTokAccountForBusiness(pool, 'biz-1');
    expect(result).toBeNull();
    expect(pool.query).toHaveBeenCalledWith(
      'select business_id, access_token, refresh_token, expires_at, connected_at from tiktok_accounts where business_id = $1',
      ['biz-1'],
    );
  });

  it('retorna a conta quando existe', async () => {
    const expiresAt = new Date('2026-09-12T12:00:00Z');
    const connectedAt = new Date('2026-09-11T12:00:00Z');
    const pool = makePool([
      { business_id: '7', access_token: 'at', refresh_token: 'rt', expires_at: expiresAt, connected_at: connectedAt },
    ]);
    const result = await getTikTokAccountForBusiness(pool, '7');
    expect(result).toEqual({
      businessId: '7',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt,
      connectedAt,
    });
  });
});

describe('saveTikTokAccountForBusiness', () => {
  it('insere/atualiza (upsert) e retorna a conta salva', async () => {
    const expiresAt = new Date('2026-09-12T12:00:00Z');
    const connectedAt = new Date('2026-09-11T12:00:00Z');
    const pool = makePool([
      {
        business_id: '9',
        access_token: 'new-at',
        refresh_token: 'new-rt',
        expires_at: expiresAt,
        connected_at: connectedAt,
      },
    ]);
    const result = await saveTikTokAccountForBusiness(pool, '9', {
      accessToken: 'new-at',
      refreshToken: 'new-rt',
      expiresAt,
    });
    expect(result).toEqual({
      businessId: '9',
      accessToken: 'new-at',
      refreshToken: 'new-rt',
      expiresAt,
      connectedAt,
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('insert into tiktok_accounts'), [
      '9',
      'new-at',
      'new-rt',
      expiresAt,
    ]);
  });
});
