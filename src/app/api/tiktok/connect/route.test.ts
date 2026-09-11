import { afterEach, describe, expect, it, vi } from 'vitest';

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));

vi.mock('@/auth', () => ({ auth: authMock }));

import { GET } from './route';

function stubEnv() {
  vi.stubEnv('TIKTOK_CLIENT_KEY', 'fake-client-key');
  vi.stubEnv('TIKTOK_TENANT_REDIRECT_URI', 'https://promopost.example.com/api/tiktok/callback');
}

describe('GET /api/tiktok/connect', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('sem sessão, redireciona para /login', async () => {
    authMock.mockResolvedValue(null);
    const request = new Request('https://promopost.example.com/api/tiktok/connect');
    const response = await GET(request);
    expect(response.headers.get('location')).toBe('https://promopost.example.com/login');
  });

  it('com sessão, redireciona pra URL de autorização da TikTok e seta o cookie de state', async () => {
    stubEnv();
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    const request = new Request('https://promopost.example.com/api/tiktok/connect');
    const response = await GET(request);

    const location = response.headers.get('location');
    expect(location).toContain('https://www.tiktok.com/v2/auth/authorize/?');
    expect(location).toContain('client_key=fake-client-key');
    expect(location).toContain('scope=video.publish');
    expect(location).toContain(
      'redirect_uri=https%3A%2F%2Fpromopost.example.com%2Fapi%2Ftiktok%2Fcallback',
    );

    const setCookie = response.headers.get('set-cookie');
    expect(setCookie).toContain('tiktok_oauth_state=');
    expect(setCookie).toMatch(/HttpOnly/i);
  });

  it('retorna 500 quando faltam as env vars do TikTok', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    const request = new Request('https://promopost.example.com/api/tiktok/connect');
    const response = await GET(request);
    expect(response.status).toBe(500);
  });
});
