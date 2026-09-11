import { afterEach, describe, expect, it, vi } from 'vitest';

const { authMock, getBusinessForUserMock, getValidAccessTokenForBusinessMock, postToTikTokMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    getBusinessForUserMock: vi.fn(),
    getValidAccessTokenForBusinessMock: vi.fn(),
    postToTikTokMock: vi.fn(),
  }),
);

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db/pool', () => ({ getPool: vi.fn(() => ({})) }));
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: getBusinessForUserMock }));
vi.mock('@/lib/social/tiktokTenantAuth', () => ({
  getValidAccessTokenForBusiness: getValidAccessTokenForBusinessMock,
}));
vi.mock('@/lib/social/tiktok', () => ({ postToTikTok: postToTikTokMock }));

import { POST } from './route';

function makeRequest(body: unknown): Request {
  return new Request('https://promopost.example.com/api/tiktok/post', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  imageUrl: 'https://x.com/img.jpg',
  title: 'Produto teste',
  description: 'Descrição teste',
};

function stubWebhookBaseUrl() {
  vi.stubEnv('WEBHOOK_BASE_URL', 'https://promopost.example.com');
}

describe('POST /api/tiktok/post', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('retorna 401 sem sessão', async () => {
    authMock.mockResolvedValue(null);
    const response = await POST(makeRequest(VALID_BODY));
    expect(response.status).toBe(401);
    expect(postToTikTokMock).not.toHaveBeenCalled();
  });

  it('retorna 400 quando falta um campo obrigatório', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    const response = await POST(makeRequest({ imageUrl: 'https://x.com/img.jpg', title: 'Só título' }));
    expect(response.status).toBe(400);
    expect(postToTikTokMock).not.toHaveBeenCalled();
  });

  it('retorna 400 quando a empresa não existe pra esse usuário', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    getBusinessForUserMock.mockResolvedValue(null);
    const response = await POST(makeRequest(VALID_BODY));
    expect(response.status).toBe(400);
    expect(postToTikTokMock).not.toHaveBeenCalled();
  });

  it('monta a URL proxied, publica e retorna o postId em caso de sucesso', async () => {
    stubWebhookBaseUrl();
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    getBusinessForUserMock.mockResolvedValue({
      id: 'biz-1',
      ownerUserId: 'user-1',
      name: 'Loja',
      createdAt: new Date(),
    });
    getValidAccessTokenForBusinessMock.mockResolvedValue('valid-access-token');
    postToTikTokMock.mockResolvedValue({ postId: 'abc123' });

    const response = await POST(makeRequest(VALID_BODY));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true, postId: 'abc123' });
    expect(getValidAccessTokenForBusinessMock).toHaveBeenCalledWith(expect.anything(), 'biz-1');
    expect(postToTikTokMock).toHaveBeenCalledWith(
      'valid-access-token',
      'https://promopost.example.com/api/tiktok-image-proxy?imageUrl=' + encodeURIComponent('https://x.com/img.jpg'),
      'Produto teste',
      'Descrição teste',
    );
  });

  it('retorna 502 com a mensagem de erro quando a renovação do token falha', async () => {
    stubWebhookBaseUrl();
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    getBusinessForUserMock.mockResolvedValue({
      id: 'biz-1',
      ownerUserId: 'user-1',
      name: 'Loja',
      createdAt: new Date(),
    });
    getValidAccessTokenForBusinessMock.mockRejectedValue(new Error('Conta do TikTok não conectada'));

    const response = await POST(makeRequest(VALID_BODY));
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json).toEqual({ ok: false, error: 'Conta do TikTok não conectada' });
    expect(postToTikTokMock).not.toHaveBeenCalled();
  });

  it('retorna 502 com a mensagem de erro quando postToTikTok falha', async () => {
    stubWebhookBaseUrl();
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    getBusinessForUserMock.mockResolvedValue({
      id: 'biz-1',
      ownerUserId: 'user-1',
      name: 'Loja',
      createdAt: new Date(),
    });
    getValidAccessTokenForBusinessMock.mockResolvedValue('valid-access-token');
    postToTikTokMock.mockRejectedValue(new Error('picture_size_check_failed'));

    const response = await POST(makeRequest(VALID_BODY));
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json).toEqual({ ok: false, error: 'picture_size_check_failed' });
  });

  it('retorna 500 quando WEBHOOK_BASE_URL não está configurado', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    getBusinessForUserMock.mockResolvedValue({
      id: 'biz-1',
      ownerUserId: 'user-1',
      name: 'Loja',
      createdAt: new Date(),
    });
    const response = await POST(makeRequest(VALID_BODY));
    expect(response.status).toBe(500);
    expect(postToTikTokMock).not.toHaveBeenCalled();
  });

  it('retorna 400 quando o corpo JSON é inválido', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    const response = await POST(
      new Request('https://promopost.example.com/api/tiktok/post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not valid json',
      }),
    );
    expect(response.status).toBe(400);
  });
});
