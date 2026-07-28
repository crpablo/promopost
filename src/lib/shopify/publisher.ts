export interface PublishResult {
  url: string;
}

interface ShopifyConfig {
  shopDomain: string;
  accessToken: string;
  blogId: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getConfig(): ShopifyConfig {
  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const blogId = process.env.SHOPIFY_BLOG_ID;
  if (!shopDomain || !accessToken || !blogId) {
    throw new Error(
      'Variáveis de ambiente do Shopify ausentes: SHOPIFY_SHOP_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN, SHOPIFY_BLOG_ID',
    );
  }
  return { shopDomain, accessToken, blogId };
}

const ARTICLE_CREATE_MUTATION = `
  mutation CreateArticle($article: ArticleCreateInput!) {
    articleCreate(article: $article) {
      article {
        id
        handle
        blog {
          handle
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function publishArticle(
  title: string,
  body: string,
  imageUrl: string,
): Promise<PublishResult> {
  const config = getConfig();

  const res = await fetch(`https://${config.shopDomain}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': config.accessToken,
    },
    body: JSON.stringify({
      query: ARTICLE_CREATE_MUTATION,
      variables: {
        article: {
          blogId: config.blogId,
          title: title.slice(0, 255),
          author: { name: 'PromoPost' },
          body: `<p>${escapeHtml(body)}</p>`,
          isPublished: false,
          image: imageUrl ? { url: imageUrl } : undefined,
        },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Falha na requisição à API do Shopify: ${res.status}`);
  }

  const json = await res.json();
  const userErrors = json.data?.articleCreate?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(`Erros do Shopify: ${userErrors.map((e: { message: string }) => e.message).join('; ')}`);
  }

  const article = json.data?.articleCreate?.article;
  if (!article) {
    throw new Error('Shopify não retornou o artigo criado');
  }

  return { url: `https://${config.shopDomain}/blogs/${article.blog.handle}/${article.handle}` };
}
