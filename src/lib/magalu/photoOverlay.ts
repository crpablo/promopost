import sharp from 'sharp';

// Marca d'água (selo de avaliação + "@promozoneoficial") do canal de origem
// sempre aparece no canto inferior esquerdo da imagem, numa faixa que cobre
// aproximadamente 38% da largura e 14% da altura a partir do canto —
// confirmado pelo usuário com múltiplos exemplos reais do canal, 2026-08-04.
// Usa proporção (não pixel fixo) porque as imagens desse bot variam de
// tamanho entre mensagens, mas mantêm a mesma disposição relativa. Esses
// valores são um primeiro ajuste — precisam de validação visual contra
// fotos reais baixadas do canal antes de considerar definitivo.
const WATERMARK_WIDTH_RATIO = 0.38;
const WATERMARK_HEIGHT_RATIO = 0.14;
const OVERLAY_LABEL = '@tobiestore';

export async function coverWatermark(imageBuffer: Buffer): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  const overlayWidth = Math.round(width * WATERMARK_WIDTH_RATIO);
  const overlayHeight = Math.round(height * WATERMARK_HEIGHT_RATIO);
  const overlayTop = height - overlayHeight;
  const overlayLeft = 0;

  const overlaySvg = Buffer.from(
    `<svg width="${overlayWidth}" height="${overlayHeight}">
      <rect width="100%" height="100%" fill="black" />
      <text x="12" y="${overlayHeight / 2}" fill="white" font-size="${Math.round(overlayHeight * 0.35)}" font-family="sans-serif" dominant-baseline="middle">${OVERLAY_LABEL}</text>
    </svg>`,
  );

  return image
    .composite([{ input: overlaySvg, top: overlayTop, left: overlayLeft }])
    .jpeg({ quality: 90 })
    .toBuffer();
}
