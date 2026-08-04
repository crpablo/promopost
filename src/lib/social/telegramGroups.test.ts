import { describe, expect, it, vi } from 'vitest';
import { sendToTelegramGroups } from './telegramGroups';

describe('sendToTelegramGroups', () => {
  it('reporta sucesso em todos os grupos quando todos os envios funcionam', async () => {
    const sendPhotoToGroup = vi.fn().mockResolvedValue(undefined);

    const result = await sendToTelegramGroups(
      ['-100111', '-100222'],
      'https://x.com/img.jpg',
      'legenda',
      { sendPhotoToGroup },
    );

    expect(result).toEqual({
      ok: true,
      results: [
        { groupId: '-100111', ok: true },
        { groupId: '-100222', ok: true },
      ],
    });
    expect(sendPhotoToGroup).toHaveBeenCalledWith('-100111', 'https://x.com/img.jpg', 'legenda');
    expect(sendPhotoToGroup).toHaveBeenCalledWith('-100222', 'https://x.com/img.jpg', 'legenda');
  });

  it('continua tentando os outros grupos quando um grupo falha (sucesso parcial)', async () => {
    const sendPhotoToGroup = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('bot removido do grupo'));

    const result = await sendToTelegramGroups(
      ['-100111', '-100222'],
      'https://x.com/img.jpg',
      'legenda',
      { sendPhotoToGroup },
    );

    expect(result).toEqual({
      ok: true,
      results: [
        { groupId: '-100111', ok: true },
        { groupId: '-100222', ok: false, error: 'bot removido do grupo' },
      ],
    });
  });

  it('reporta ok:false quando todos os grupos falham', async () => {
    const sendPhotoToGroup = vi.fn().mockRejectedValue(new Error('grupo inválido'));

    const result = await sendToTelegramGroups(['-100111'], 'https://x.com/img.jpg', 'legenda', {
      sendPhotoToGroup,
    });

    expect(result).toEqual({
      ok: false,
      results: [{ groupId: '-100111', ok: false, error: 'grupo inválido' }],
    });
  });

  it('retorna resultado vazio quando a lista de grupos está vazia', async () => {
    const sendPhotoToGroup = vi.fn();

    const result = await sendToTelegramGroups([], 'https://x.com/img.jpg', 'legenda', {
      sendPhotoToGroup,
    });

    expect(result).toEqual({ ok: false, results: [] });
    expect(sendPhotoToGroup).not.toHaveBeenCalled();
  });
});
