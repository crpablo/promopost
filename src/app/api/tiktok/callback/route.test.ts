import { afterEach, describe, expect, it, vi } from 'vitest';

const { authMock, exchangeTikTokTokenMock, getBusinessForUserMock, saveTikTokAccountForBusinessMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    exchangeTikTokTokenMock: vi.fn(),
    getBusinessForUserMock: vi.fn(),
    saveTikTokAccountForBusinessMock: vi.fn(),
  }),
);

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/social/tiktokTokenStore', () => ({ exchangeTikTokToken: exchangeTikTokTokenMock }));
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: getBusinessForUserMock }));
vi.mock('@/lib/db/tiktokAccounts', () => ({ saveTikTokAccountForBusiness: saveTikTokAccountForBusinessMock }));
vi.mock('@/lib/db/pool', () => ({ getPool: vi.fn(() => ({})) }));

import { GET } from './route';

function stubEnv() {
  vi.stubEnv('TIKTOK_TENANT_REDIRECT_URI', 'https://promopost.example.com/api/tiktok/callback');
}

function makeRequest(url: string, cookieState?: string): Request {
  const headers = new Headers();
  if (cookieState) headers.set('cookie', `tiktok_oauth_state=${cookieState}`);
  return new Request(url, { headers });
}

describe('GET /api/tiktok/callback', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('sem sessão, redireciona para /login', async () => {
    authMock.mockResolvedValue(null);
    const request = makeRequest('https://promopost.example.com/api/tiktok/callback?code=abc&state=xyz', 'xyz');
    const response = await GET(request);
    expect(response.headers.get('location')).toBe('https://promopost.example.com/login');
  });

  it('troca o código, salva a conta vinculada à business e redireciona pro dashboard', async () => {
    stubEnv();
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    exchangeTikTokTokenMock.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', expiresAt: 1234567890000 });
    getBusinessForUserMock.mockResolvedValue({
      id: 'biz-1',
      ownerUserId: 'user-1',
      name: 'Loja',
      createdAt: new Date(),
    });
    saveTikTokAccountForBusinessMock.mockResolvedValue({});

    const request = makeRequest('https://promopost.example.com/api/tiktok/callback?code=abc&state=xyz', 'xyz');
    const response = await GET(request);

    expect(exchangeTikTokTokenMock).toHaveBeenCalledWith({
      grant_type: 'authorization_code',
      code: 'abc',
      redirect_uri: 'https://promopost.example.com/api/tiktok/callback',
    });
    expect(saveTikTokAccountForBusinessMock).toHaveBeenCalledWith(expect.anything(), 'biz-1', {
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: new Date(1234567890000),
    });
    expect(response.headers.get('location')).toBe('https://promopost.example.com/dashboard');
  });

  it('usa AUTH_URL como base do redirect final em vez do host de request.url (atrás de proxy, request.url reflete o endereço interno do container, não o domínio público)', async () => {
    stubEnv();
    vi.stubEnv('AUTH_URL', 'https://promopost.tobiestore.com.br');
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    exchangeTikTokTokenMock.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', expiresAt: 1234567890000 });
    getBusinessForUserMock.mockResolvedValue({
      id: 'biz-1',
      ownerUserId: 'user-1',
      name: 'Loja',
      createdAt: new Date(),
    });
    saveTikTokAccountForBusinessMock.mockResolvedValue({});

    const request = makeRequest('http://localhost:3000/api/tiktok/callback?code=abc&state=xyz', 'xyz');
    const response = await GET(request);

    expect(response.headers.get('location')).toBe('https://promopost.tobiestore.com.br/dashboard');
  });

  it('quando a TikTok manda error, redireciona pro dashboard com tiktok_error=1', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    const request = makeRequest('https://promopost.example.com/api/tiktok/callback?error=access_denied');
    const response = await GET(request);
    expect(response.headers.get('location')).toBe('https://promopost.example.com/dashboard?tiktok_error=1');
    expect(exchangeTikTokTokenMock).not.toHaveBeenCalled();
  });

  it('quando o state não bate com o cookie, redireciona pro dashboard com tiktok_error=1', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    const request = makeRequest(
      'https://promopost.example.com/api/tiktok/callback?code=abc&state=xyz',
      'diferente',
    );
    const response = await GET(request);
    expect(response.headers.get('location')).toBe('https://promopost.example.com/dashboard?tiktok_error=1');
    expect(exchangeTikTokTokenMock).not.toHaveBeenCalled();
  });

  it('quando falta o cookie de state, redireciona pro dashboard com tiktok_error=1', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    const request = makeRequest('https://promopost.example.com/api/tiktok/callback?code=abc&state=xyz');
    const response = await GET(request);
    expect(response.headers.get('location')).toBe('https://promopost.example.com/dashboard?tiktok_error=1');
  });

  it('quando a troca de token falha, redireciona pro dashboard com tiktok_error=1', async () => {
    stubEnv();
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    exchangeTikTokTokenMock.mockRejectedValue(new Error('Falha ao trocar token do TikTok: boom'));
    const request = makeRequest('https://promopost.example.com/api/tiktok/callback?code=abc&state=xyz', 'xyz');
    const response = await GET(request);
    expect(response.headers.get('location')).toBe('https://promopost.example.com/dashboard?tiktok_error=1');
    expect(saveTikTokAccountForBusinessMock).not.toHaveBeenCalled();
  });
});
