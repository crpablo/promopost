# PromoPost — Shopee como segundo marketplace

## Contexto e motivação

O PromoPost hoje suporta um único marketplace (Mercado Livre): captura links no canal do Telegram, extrai dados do produto, gera um link de afiliado, e publica no blog Shopify + redes sociais. Este documento cobre a extensão pra suportar a **Shopee** como segundo marketplace, conforme previsto desde o spec original do MVP (`docs/superpowers/specs/2026-07-27-promopost-mvp-design.md`, seção "Próximos passos").

## Escopo deste documento

**Dentro do escopo:**
- Detectar automaticamente se um link recebido (depois de resolvido) é do Mercado Livre ou da Shopee, e rotear pro fluxo de extração correto.
- Extrair título/preço/imagem de produtos da Shopee via scraping leve da própria página (meta tags), reaproveitando a sessão de browser já aberta pra resolver o redirect.
- Gerar o link de afiliado da Shopee via API oficial (GraphQL, `generateShortLink`), autenticada com assinatura HMAC-SHA256 (`app_id`/`secret_key`).
- Mover o tipo `Product` (hoje em `src/lib/mercadolivre/`) pra um módulo neutro, compartilhado entre os dois marketplaces.

**Fora do escopo (decisões já tomadas neste brainstorm):**
- **Usar a API `productOfferV2` da Shopee pra buscar dados do produto.** Essa API só retorna produtos cadastrados como oferta ativa de afiliado — um link Shopee válido pode não aparecer ali (comissão não configurada), o que faria a promoção falhar sem alternativa. Optou-se por continuar extraindo os dados via scraping da própria página (mesmo princípio já usado pro Mercado Livre), usando a API oficial só onde ela é estritamente necessária: gerar o link de afiliado rastreável.
- **Suporte a Amazon ou outros marketplaces.** Fica pra um sub-projeto futuro, seguindo o mesmo roadmap do MVP original.
- **Mudança no template de texto do post ou nas redes sociais.** Ambos já são agnósticos de marketplace (recebem apenas `{title, price, imageUrl}` + link de afiliado genéricos) — nenhuma mudança necessária ali.
- **Sessão logada / bootstrap manual pra Shopee.** Diferente do Mercado Livre, a Shopee tem API oficial autenticada por credenciais fixas (`app_id`/`secret_key`) — não há sessão de painel que expira nem re-bootstrap periódico.

## Por que este approach (arquitetura)

**O desafio central:** o link recebido do canal do Telegram pode vir através de um encurtador de terceiro (mesmo padrão já visto no Mercado Livre, ex: `go.promozone.ai`) cujo destino real só é revelado depois de seguir o redirect — que pode ser client-side via JavaScript, exigindo um browser real (Playwright) pra resolver. Isso significa que **não é possível decidir estaticamente**, só olhando a URL recebida, se um link é do Mercado Livre ou da Shopee.

**A decisão:** o mesmo script Playwright que já roda na Vercel Sandbox (`generate-link.playwright.mjs`) continua sendo o único ponto de entrada. Ele resolve o redirect (como já faz hoje), e só então confere o hostname final resolvido pra decidir o fluxo:
- **Mercado Livre** → fluxo atual, sem nenhuma mudança (scraping da página + geração do link via painel logado com sessão salva).
- **Shopee** → fluxo novo: reaproveita a mesma sessão de browser já aberta (sem precisar de novo login) pra extrair título/preço/imagem da página via meta tags, e então faz uma chamada HTTP simples (via `fetch`, sem precisar de um segundo browser) à API GraphQL oficial da Shopee — com uma assinatura HMAC-SHA256 calculada a partir de `app_id`/`secret_key` — pra gerar o link de afiliado rastreável.
- **Qualquer outro domínio** → erro `MARKETPLACE_NOT_SUPPORTED`.

Essa decisão evita criar uma segunda Sandbox ou um orquestrador separado: a infraestrutura de resolução de redirect (já validada em produção pro Mercado Livre) é reaproveitada integralmente, e o "branch" por marketplace acontece só depois que sabemos o destino real do link. O custo extra de continuar usando Playwright pra extrair os dados da Shopee (em vez de usar `productOfferV2` da API oficial) é pequeno — poucos segundos a mais de execução na Sandbox, que já roda de qualquer forma pra resolver o redirect — e evita o risco de falha silenciosa quando um produto não está cadastrado como oferta ativa de afiliado.

## Arquitetura

```
POST /api/webhook { link, coupon?, discountedPrice? }
  → fetchProductAndAffiliateLink(link):
      → Sandbox + Playwright: resolve redirect (HTTP ou client-side JS)
        até o destino final — mesmo passo já existente, sem mudança
      → confere o hostname resolvido:
          - mercadolivre.com.br / mercadolibre.com
              → fluxo atual: scraping da página + painel de afiliados logado
          - shopee.com.br
              → extrai título/preço/imagem via meta tags da página
                (reaproveita a sessão de browser já aberta)
              → gera assinatura HMAC-SHA256 (app_id + secret_key)
              → POST GraphQL: generateShortLink(originUrl) → shortLink
          - outro domínio
              → erro MARKETPLACE_NOT_SUPPORTED
      → retorna { product: {title, price, imageUrl}, affiliateLink }
        — mesmo formato de sempre, resto do pipeline não muda
  → buildPostText, Shopify Publisher, postToSocialNetworks
      — nenhuma mudança, já são agnósticos de marketplace
  → resposta 200 { postUrl, facebook, instagram, story, tiktok }
    ou 4xx/5xx { passo, erro }
```

## Componentes

| Componente | Responsabilidade | Depende de |
|---|---|---|
| **Marketplace Detector** (dentro do script Playwright existente) | Depois de resolver o redirect, confere o hostname final e decide qual fluxo seguir — Mercado Livre, Shopee, ou erro de marketplace não suportado. | Playwright (já usado hoje) |
| **Shopee Product Scraper** (novo, mesmo script) | Extrai título/preço/imagem da página de produto Shopee via meta tags, reaproveitando a sessão de browser já aberta — mesmo princípio já usado pro Mercado Livre. | Playwright |
| **Shopee Affiliate Client** (novo, mesmo script) | Calcula a assinatura HMAC-SHA256 a partir de `app_id`/`secret_key` e chama a API GraphQL oficial da Shopee (`generateShortLink`) pra gerar o link de afiliado rastreável. A lógica de assinatura é extraída como função pura, testável isoladamente. | API oficial da Shopee (`open-api.affiliate.shopee.com.br` ou domínio regional equivalente), credenciais |
| **Product type compartilhado** (movido) | Interface `{title, price, imageUrl}`, hoje declarada em `src/lib/mercadolivre/affiliateLink.ts`, passa a viver num módulo neutro (`src/lib/marketplace/types.ts`) usado pelos dois fetchers e pelo resto do pipeline. | — |
| **Webhook / Pipeline** (`affiliateLink.ts`, `pipeline.ts`) | Mapeia os novos códigos de erro do script (`MARKETPLACE_NOT_SUPPORTED`, falha na API Shopee, credenciais ausentes) pras classes de erro já existentes (`InvalidLinkError`, erro genérico do passo `affiliate_link`). | — |

## Fluxo de dado

Ver diagrama na seção Arquitetura acima — o formato de entrada/saída do pipeline (`POST /api/webhook` → `{postUrl, facebook, instagram, story, tiktok}`) não muda; só a implementação interna de `fetchProductAndAffiliateLink` ganha um segundo caminho.

## Tratamento de erro

- **`LINK_NOT_MERCADOLIVRE` generaliza pra `MARKETPLACE_NOT_SUPPORTED`** — cobre qualquer domínio que não seja Mercado Livre nem Shopee, mapeado pro mesmo `InvalidLinkError` (step `link_parse`, HTTP 400) já usado hoje.
- **`SESSION_EXPIRED` continua existindo, mas só se aplica ao fluxo Mercado Livre** — a Shopee usa credenciais fixas (`app_id`/`secret_key`), sem sessão de painel que expira.
- **Credenciais da Shopee ausentes** (variáveis de ambiente não configuradas) — reportado como erro claro assim que um link Shopee é detectado, análogo ao padrão `{ok:false, error:'não configurado'}` já usado nas redes sociais, mas aqui interrompendo o pipeline inteiro (sem produto, sem post em lugar nenhum) já que a busca do produto é obrigatória, não best-effort.
- **Falha na chamada `generateShortLink`** (assinatura inválida, API fora do ar, erro de negócio da Shopee) — mapeada pro mesmo step `affiliate_link` (HTTP 502) já usado hoje pros erros do gerador de link do Mercado Livre.
- **`PRODUCT_NOT_FOUND` reaproveitado sem mudança** — se o scraping da página Shopee não encontrar título, preço ou imagem, mesmo tratamento (step `product_fetch`, HTTP 502) já usado pro Mercado Livre.

Sem retentativa automática em nenhum passo — mesma filosofia do resto do projeto.

## Testagem

- **Orquestrador TS** (`affiliateLink.ts`): testes unitários com mock do resultado do script (stdout/stderr/exitCode), cobrindo os novos casos — `MARKETPLACE_NOT_SUPPORTED`, credenciais Shopee ausentes, falha na API — seguindo o mesmo padrão dos testes já existentes pra Mercado Livre.
- **Assinatura HMAC-SHA256**: extraída como função pura e testada isoladamente com um vetor de teste conhecido (entrada/saída determinística), sem depender de rede nem do script Playwright.
- **Script Playwright**: continua sem teste automatizado (mesma limitação já aceita pro Mercado Livre — depende de browser real, sessão/credenciais reais e do layout ao vivo do site). Validação manual com 2–3 links reais da Shopee antes de considerar pronto, com captura de screenshot em caso de falha (mesmo padrão já usado).
- **Ponta a ponta**: uma execução real completa com um link Shopee real (link → post em rascunho no Shopify + redes sociais), conferindo que o roteamento por marketplace funcionou.

## Riscos conhecidos

- **Documentação pública da API de afiliados da Shopee é escassa.** O processo exato de autenticação (formato do header, estrutura exata da assinatura) e eventuais permissões adicionais necessárias no painel só vão ficar confirmados durante a configuração real — mesmo padrão de descoberta iterativa que já aconteceu com a API do TikTok (ex: o scope `video.publish` não aparecia até habilitar "Direct Post").
- **Formato exato das meta tags da página de produto Shopee ainda não confirmado.** Vai ser usado o mesmo padrão de seletores já usado pro Mercado Livre (`og:image`, `meta[itemprop="price"]`) como ponto de partida, ajustado durante a validação manual real caso a Shopee use um formato diferente.
- **Possível proteção anti-bot da Shopee contra Chromium headless**, similar à já enfrentada no Mercado Livre (que exigiu esconder `navigator.webdriver`, usar user-agent real, `--disable-blink-features=AutomationControlled`). Só confirma na prática; a mesma configuração de browser já usada pro ML deve servir de ponto de partida.
- **Domínio regional da API.** A documentação encontrada aponta o endpoint `open-api.affiliate.shopee.co.id` (Indonésia) — o endpoint correto pra contas brasileiras (`open-api.affiliate.shopee.com.br` ou equivalente) precisa ser confirmado durante a configuração real, dentro do painel de afiliados do usuário.

## Próximos passos (fora deste documento)

Depois desta integração, o roadmap original do MVP ainda lista: gatilho via WhatsApp, suporte à Amazon, geração de texto do post via LLM (hoje ainda é template fixo), e migração pra arquitetura de fila assíncrona — nenhum desses é abordado aqui.
