import sharp from 'sharp';

// Marca d'água da Shopee tem duas partes: uma linha de texto centralizada
// "@promozoneoficial" por volta de 78-80% da altura da imagem, e uma barra
// escura de avaliação em largura total ("4.6 ★★★★★ N mil avaliações") nos
// últimos ~15-20% da altura — confirmado pelo usuário com múltiplos
// exemplos reais do canal, 2026-08-05. Cobrimos as duas com uma única faixa
// preta de largura total, começando um pouco antes do início da barra de
// avaliação (22% da altura, não 20%) pra garantir que a linha de texto
// centralizada também fique coberta. Usa proporção (não pixel fixo) porque
// as imagens desse bot variam de tamanho entre mensagens, mas mantêm a
// mesma disposição relativa. Esses valores são um primeiro ajuste —
// precisam de validação visual contra fotos reais baixadas do canal antes
// de considerar definitivo (mesmo aviso já feito pro Magalu, ver
// src/lib/magalu/photoOverlay.ts).
const WATERMARK_WIDTH_RATIO = 1;
const WATERMARK_HEIGHT_RATIO = 0.22;
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
