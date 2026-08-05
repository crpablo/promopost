import sharp from 'sharp';

// Marca d'água do canal de origem tem duas partes: uma linha de texto
// "@promozoneoficial" e, abaixo dela, o selo de avaliação — mesma
// estrutura de duas partes já vista na Shopee (ver
// src/lib/shopee/photoOverlay.ts), com o mesmo padrão confirmado pelo
// usuário em todas as fotos do canal. A primeira estimativa (38% largura
// × 14% altura, canto inferior esquerdo) cobria só o selo e deixava
// "@promozoneoficial" visível acima — corrigido em 2026-08-05 após
// validação com fotos reais do canal, trocando pra faixa de largura total
// (mesmo padrão da Shopee) cobrindo os últimos 25% da altura. Usa
// proporção (não pixel fixo) porque as imagens desse bot variam de tamanho
// entre mensagens, mas mantêm a mesma disposição relativa.
const WATERMARK_WIDTH_RATIO = 1;
const WATERMARK_HEIGHT_RATIO = 0.25;
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
      <text x="50%" y="50%" fill="white" font-size="${Math.round(overlayHeight * 0.35)}" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">${OVERLAY_LABEL}</text>
    </svg>`,
  );

  return image
    .composite([{ input: overlaySvg, top: overlayTop, left: overlayLeft }])
    .jpeg({ quality: 90 })
    .toBuffer();
}
