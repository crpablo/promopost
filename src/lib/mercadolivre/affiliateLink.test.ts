import { afterEach, describe, expect, it, vi } from 'vitest';

const { runCommandMock, writeFilesMock, getOrCreateMock } = vi.hoisted(() => {
  const runCommandMock = vi.fn();
  const writeFilesMock = vi.fn();
  const getOrCreateMock = vi.fn().mockResolvedValue({
    writeFiles: writeFilesMock,
    runCommand: runCommandMock,
  });
  return { runCommandMock, writeFilesMock, getOrCreateMock };
});

vi.mock('@vercel/sandbox', () => ({
  Sandbox: { getOrCreate: getOrCreateMock },
}));

vi.mock('../session/sessionStore', () => ({
  loadSession: vi.fn().mockResolvedValue(Buffer.from('{"cookies":[]}')),
}));

import { generateAffiliateLink } from './affiliateLink';

describe('generateAffiliateLink', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('retorna o link de afiliado quando o script termina com sucesso', async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 0,
      stdout: async () => 'https://mercadolivre.com/sec/abc123\n',
      stderr: async () => '',
    });

    const link = await generateAffiliateLink('https://mercadolivre.com.br/MLB123');

    expect(link).toBe('https://mercadolivre.com/sec/abc123');
    expect(writeFilesMock).toHaveBeenCalled();
    expect(runCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: 'node',
        args: ['generate-link.mjs', 'https://mercadolivre.com.br/MLB123'],
      }),
    );
  });

  it('lança SessionExpiredError quando o script reporta SESSION_EXPIRED no stderr', async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 1,
      stdout: async () => '',
      stderr: async () => 'SESSION_EXPIRED',
    });

    await expect(generateAffiliateLink('https://mercadolivre.com.br/MLB123')).rejects.toThrow(
      'SESSION_EXPIRED',
    );
  });

  it('lança erro genérico quando o script falha por outro motivo', async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 1,
      stdout: async () => '',
      stderr: async () => 'TimeoutError: locator not found',
    });

    await expect(generateAffiliateLink('https://mercadolivre.com.br/MLB123')).rejects.toThrow(
      'Falha ao gerar link de afiliado',
    );
  });
});
