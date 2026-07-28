import type { Product } from './mercadolivre/productFetcher';

export type PipelineStep = 'link_parse' | 'product_fetch' | 'affiliate_link' | 'shopify_publish';

export class PipelineError extends Error {
  step: PipelineStep;
  code?: string;

  constructor(step: PipelineStep, message: string, code?: string) {
    super(message);
    this.name = 'PipelineError';
    this.step = step;
    this.code = code;
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super('SESSION_EXPIRED');
    this.name = 'SessionExpiredError';
  }
}

export interface PipelineResult {
  postUrl: string;
}

export interface PipelineDeps {
  parseItemId: (link: string) => string | null;
  fetchProduct: (itemId: string) => Promise<Product>;
  generateAffiliateLink: (productLink: string) => Promise<string>;
  buildPostText: (product: Product, affiliateLink: string) => string;
  publishArticle: (title: string, body: string, imageUrl: string) => Promise<{ url: string }>;
}

export async function runPipeline(link: string, deps: PipelineDeps): Promise<PipelineResult> {
  const itemId = deps.parseItemId(link);
  if (!itemId) {
    throw new PipelineError('link_parse', 'Link inválido: não é um link de produto do Mercado Livre');
  }

  let product: Product;
  try {
    product = await deps.fetchProduct(itemId);
  } catch (err) {
    throw new PipelineError('product_fetch', (err as Error).message);
  }

  let affiliateLink: string;
  try {
    affiliateLink = await deps.generateAffiliateLink(link);
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      throw new PipelineError('affiliate_link', err.message, 'SESSION_EXPIRED');
    }
    throw new PipelineError('affiliate_link', (err as Error).message);
  }

  const body = deps.buildPostText(product, affiliateLink);

  let published: { url: string };
  try {
    published = await deps.publishArticle(product.title, body, product.imageUrl);
  } catch (err) {
    throw new PipelineError('shopify_publish', (err as Error).message);
  }

  return { postUrl: published.url };
}
