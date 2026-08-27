import { afterEach, describe, expect, it, vi } from 'vitest';

const { postToTikTokMock } = vi.hoisted(() => ({ postToTikTokMock: vi.fn() }));

vi.mock('@/lib/social/tiktok', () => ({ postToTikTok: postToTikTokMock }));

import { POST } from './route';

function makeRequest(body: unknown) {
  return new Request('https://promopost.example.com/api/admin/tiktok-post', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  token: 'correct-token',
  imageUrl: 'https://http2.mlstatic.com/D_1.jpg',
  title: 'Produto teste',
  description: 'Descrição teste',
};

describe('POST /api/admin/tiktok-post', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('retorna 401 quando o token está errado', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'correct-token');
    const response = await POST(makeRequest({ ...VALID_BODY, token: 'wrong-token' }));
    expect(response.status).toBe(401);
    expect(postToTikTokMock).not.toHaveBeenCalled();
  });

  it('retorna 401 quando ADMIN_TOKEN não está configurado no ambiente', async () => {
    const response = await POST(makeRequest(VALID_BODY));
    expect(response.status).toBe(401);
  });

  it('retorna 400 quando falta um campo obrigatório', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'correct-token');
    const bodyWithoutImageUrl = { token: 'correct-token', title: 'Produto teste', description: 'Descrição teste' };
    const response = await POST(makeRequest(bodyWithoutImageUrl));
    expect(response.status).toBe(400);
    expect(postToTikTokMock).not.toHaveBeenCalled();
  });

  it('retorna 500 quando WEBHOOK_BASE_URL não está configurado', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'correct-token');
    const response = await POST(makeRequest(VALID_BODY));
    expect(response.status).toBe(500);
    expect(postToTikTokMock).not.toHaveBeenCalled();
  });

  it('monta a URL proxied e chama postToTikTok, retornando o postId em caso de sucesso', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'correct-token');
    vi.stubEnv('WEBHOOK_BASE_URL', 'https://promopost.tobiestore.com.br');
    postToTikTokMock.mockResolvedValue({ postId: 'abc123' });

    const response = await POST(makeRequest(VALID_BODY));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true, postId: 'abc123' });
    expect(postToTikTokMock).toHaveBeenCalledWith(
      'https://promopost.tobiestore.com.br/api/tiktok-image-proxy?imageUrl=' +
        encodeURIComponent('https://http2.mlstatic.com/D_1.jpg'),
      'Produto teste',
      'Descrição teste',
    );
  });

  it('retorna 502 com a mensagem de erro quando postToTikTok falha', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'correct-token');
    vi.stubEnv('WEBHOOK_BASE_URL', 'https://promopost.tobiestore.com.br');
    postToTikTokMock.mockRejectedValue(new Error('picture_size_check_failed'));

    const response = await POST(makeRequest(VALID_BODY));
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json).toEqual({ ok: false, error: 'picture_size_check_failed' });
  });
});
