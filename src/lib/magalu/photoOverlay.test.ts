import { describe, expect, it, vi } from 'vitest';

const { compositeMock, jpegMock, toBufferMock, metadataMock, sharpMock } = vi.hoisted(() => {
  const toBufferMock = vi.fn();
  const jpegMock = vi.fn(() => ({ toBuffer: toBufferMock }));
  const compositeMock = vi.fn(() => ({ jpeg: jpegMock }));
  const metadataMock = vi.fn();
  const sharpMock = vi.fn(() => ({ metadata: metadataMock, composite: compositeMock }));
  return { compositeMock, jpegMock, toBufferMock, metadataMock, sharpMock };
});

vi.mock('sharp', () => ({ default: sharpMock }));

import { coverWatermark } from './photoOverlay';

describe('coverWatermark', () => {
  it('composita um retângulo no canto inferior esquerdo, proporcional ao tamanho da imagem', async () => {
    metadataMock.mockResolvedValue({ width: 1000, height: 1000 });
    toBufferMock.mockResolvedValue(Buffer.from([9, 9, 9]));

    const result = await coverWatermark(Buffer.from([1, 2, 3]));

    expect(sharpMock).toHaveBeenCalledWith(Buffer.from([1, 2, 3]));
    expect(compositeMock).toHaveBeenCalledWith([
      expect.objectContaining({ top: 860, left: 0 }),
    ]);
    expect(jpegMock).toHaveBeenCalledWith({ quality: 90 });
    expect(result).toEqual(Buffer.from([9, 9, 9]));
  });

  it('escala a região coberta proporcionalmente pra uma imagem de tamanho diferente', async () => {
    metadataMock.mockResolvedValue({ width: 2000, height: 1500 });
    toBufferMock.mockResolvedValue(Buffer.from([9]));

    await coverWatermark(Buffer.from([1]));

    expect(compositeMock).toHaveBeenCalledWith([expect.objectContaining({ top: 1290, left: 0 })]);
  });
});
