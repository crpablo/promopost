import { afterEach, describe, expect, it, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('resend', () => ({
  // Vitest 4's tinyspy requires a `function`/`class` implementation (not an
  // arrow function) when the mock is invoked with `new`, so this uses a
  // function expression instead of the arrow function in the plan's literal
  // brief text — same shape, same behavior.
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: sendMock } };
  }),
}));

import { sendMagicLink } from './sendMagicLink';

describe('sendMagicLink', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('envia o email via Resend com o link e o remetente configurado', async () => {
    vi.stubEnv('RESEND_API_KEY', 'fake-key');
    vi.stubEnv('EMAIL_FROM', 'PromoPost <login@promopost.tobiestore.com.br>');
    sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });

    await sendMagicLink({ to: 'dono@loja.com', url: 'https://promopost.tobiestore.com.br/api/auth/callback/nodemailer?token=abc' });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'PromoPost <login@promopost.tobiestore.com.br>',
        to: 'dono@loja.com',
        subject: 'Seu link de acesso ao PromoPost',
      }),
    );
    const call = sendMock.mock.calls[0][0];
    expect(call.html).toContain('https://promopost.tobiestore.com.br/api/auth/callback/nodemailer?token=abc');
  });

  it('lança erro quando o Resend retorna erro', async () => {
    vi.stubEnv('RESEND_API_KEY', 'fake-key');
    sendMock.mockResolvedValue({ data: null, error: { message: 'domínio não verificado' } });

    await expect(
      sendMagicLink({ to: 'dono@loja.com', url: 'https://x.com/callback' }),
    ).rejects.toThrow('Falha ao enviar email de login: domínio não verificado');
  });
});
