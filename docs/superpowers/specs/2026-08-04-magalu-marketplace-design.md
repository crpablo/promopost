# PromoPost — Magalu como quarto marketplace

## Contexto e motivação

O PromoPost hoje suporta três marketplaces (Mercado Livre, Shopee, Amazon): captura links no canal do Telegram, extrai dados do produto, gera um link de afiliado, e publica no blog Shopify + redes sociais. Este documento cobre a extensão pra suportar o **Magalu** (Magazine Luiza) como quarto marketplace.

O usuário já tem conta aprovada no programa de afiliados ("Parceiro Magalu"). Diferente do que a pesquisa inicial sobre o programa sugeria (um painel de geração de link parecido com o do Mercado Livre), a investigação direta com o usuário mostrou que o Magalu **não precisa de sessão logada nem de automação de formulário**: o link de afiliado é a própria URL do produto em `magazineluiza.com.br`, com os parâmetros `partner_id`/`promoter_id`/`utm_*` identificando o afiliado. O usuário confirmou esse formato como o mesmo que já circula no canal do Telegram (postado por outro afiliado) — só precisamos trocar os valores desses parâmetros pelos do usuário.

## Escopo deste documento

**Dentro do escopo:**
- Detectar automaticamente se um link recebido (depois de resolvido) é do Magalu (`magazineluiza.com.br`), somando aos três marketplaces já suportados.
- Extrair título/preço/imagem de produtos do Magalu via scraping da própria página, reaproveitando o fallback genérico já usado por Mercado Livre e Shopee (sem seletor específico a princípio).
- Gerar o link de afiliado do Magalu **sem chamada de API e sem sessão logada** — sobrescrevendo os parâmetros `partner_id`, `promoter_id`, `utm_source`, `utm_medium`, `utm_campaign` na URL resolvida do produto pelos valores do usuário, no lugar dos valores de quem postou originalmente no canal.

**Fora do escopo (decisões já tomadas neste brainstorm):**
- **Cupom de loja/categoria via `magazinevoce.com.br`.** O usuário confirmou que esse formato (a "lojinha" pessoal do afiliado dentro do domínio do Magalu) é usado no canal só pra cupons de loja inteira, não pra produto individual — mesmo padrão do caso "lista" já resolvido separadamente pro Mercado Livre. Fica anotado como extensão futura, não implementado agora.
- **Validação de que `partner_id`/`promoter_id` são realmente permanentes e não expiram.** O usuário forneceu os dois valores a partir de um link real gerado pela própria conta — tratamos como configuração fixa (variável de ambiente), sem mecanismo de renovação automática. Se algum dia parar de funcionar, precisa ser investigado como um problema separado.

## Por que este approach (arquitetura)

O mesmo script Playwright que já resolve o redirect e faz o roteamento por marketplace (Mercado Livre → Shopee → Amazon → erro) ganha um quarto branch. Depois de resolver o redirect e confirmar que o destino é `magazineluiza.com.br`, o script:
1. Extrai título/preço/imagem da própria página (scraping, reaproveitando o fallback genérico já usado por Mercado Livre/Shopee).
2. Monta o link de afiliado só ajustando a query string da URL resolvida — sem segunda chamada de rede, sem assinatura, sem sessão logada. Mesmo princípio da Amazon (`buildAmazonAffiliateLink`), mas sobrescrevendo cinco parâmetros em vez de um.

Isso torna o Magalu o marketplace mais simples de integrar até agora — não herda nenhum dos dois problemas que os outros três tiveram: não precisa de sessão logada (como o Mercado Livre), não precisa de chamada de API assinada (como a Shopee), e não há indício, até o momento, de bloqueio anti-bot agressivo (como a Amazon) — isso só será confirmado na validação ao vivo.

## Arquitetura

```
POST /api/webhook { link, coupon?, discountedPrice? }
  → fetchProductAndAffiliateLink(link):
      → resolve redirect (HTTP ou client-side JS) até o destino final
        — mesmo passo já existente, sem mudança
      → confere o hostname resolvido:
          - mercadolivre.com.br / mercadolibre.com → fluxo atual
          - shopee.com.br → fluxo atual
          - amazon.com.br → fluxo atual
          - magazineluiza.com.br (NOVO)
              → extrai título/preço/imagem via scraping da página
                (fallback genérico, mesmo usado por ML/Shopee)
              → checa MAGALU_PARTNER_ID e MAGALU_PROMOTER_ID configuradas
              → monta affiliateLink = URL resolvida com os parâmetros
                partner_id, promoter_id, utm_source=divulgador,
                utm_medium=magalu, utm_campaign=<promoter_id>
                sobrescritos (adiciona ou substitui os valores do
                afiliado original que postou no canal)
          - outro domínio → erro MARKETPLACE_NOT_SUPPORTED
      → retorna { product: {title, price, imageUrl}, affiliateLink }
        — mesmo formato de sempre, resto do pipeline não muda
  → buildPostText, Shopify Publisher, postToSocialNetworks
      — nenhuma mudança, já são agnósticos de marketplace
```

## Componentes

| Componente | Responsabilidade | Depende de |
|---|---|---|
| **Marketplace Detector** (dentro do script Playwright existente) | Passa a reconhecer `magazineluiza.com.br` como quarto destino válido. | Playwright (já usado hoje) |
| **Magalu Product Scraper** (mesmo script, sem seletor novo a princípio) | Extrai título/preço/imagem via o mesmo fallback genérico já usado por ML/Shopee (`h1`, `og:title`, `og:image`, `meta[itemprop=price]`). Só ganha seletor específico se a validação ao vivo mostrar que o genérico falha (mesmo critério usado pra decidir isso na Amazon). | Playwright |
| **Magalu Affiliate Link Builder** (novo, função pura, testável isoladamente) | Recebe a URL resolvida do produto, `partnerId` e `promoterId`, devolve a mesma URL com `partner_id`, `promoter_id`, `utm_source`, `utm_medium`, `utm_campaign` sobrescritos. Sem rede, sem estado. | — |
| **Product type compartilhado** (`src/lib/marketplace/types.ts`) | Campo `marketplace` ganha `'magalu'` como quarto valor possível. | — |
| **Legenda social** (`src/lib/social/caption.ts`) | Mapa de hashtags ganha `magalu: '#magalu'`. | — |
| **Extrator de promoção do Telegram** (`src/lib/telegram/extractPromo.ts`) | Prompt da LLM passa a reconhecer promoções do Magalu como válidas, junto de ML/Shopee/Amazon. | — |
| **Webhook / Pipeline** (`affiliateLink.ts`) | Mapeia `MAGALU_CREDENTIALS_MISSING` (partner/promoter ausentes) pro mesmo padrão de erro já usado pra Shopee/Amazon; inclui `'magalu'` no mapeamento de `marketplace` da resposta do script. | — |

## Fluxo de dado

Idêntico ao pipeline já documentado (`POST /api/webhook` → `fetchProductAndAffiliateLink` → `buildPostText` → `publishArticle` (Shopify) → `postToSocialNetworks`). Nenhuma mudança no formato de entrada/saída de nenhuma rota — só um quarto caminho dentro de `fetchProductAndAffiliateLink`.

## Tratamento de erro

- **`MAGALU_CREDENTIALS_MISSING`** — `MAGALU_PARTNER_ID` ou `MAGALU_PROMOTER_ID` não configuradas, reportado assim que o marketplace é identificado como Magalu, antes de gastar tempo com scraping. Mesmo padrão de severidade já usado pra `SHOPEE_CREDENTIALS_MISSING`/`AMAZON_CREDENTIALS_MISSING`.
- **`PRODUCT_NOT_FOUND`** — reaproveitado sem mudança, mesmo critério (título, preço ou imagem ausente após tentar todos os seletores).
- **`MARKETPLACE_NOT_SUPPORTED`** — continua cobrindo qualquer domínio que não seja Mercado Livre, Shopee, Amazon nem Magalu.
- **Sem `SESSION_EXPIRED` equivalente** — o Magalu não precisa de sessão logada pra gerar o link, então esse código de erro simplesmente não se aplica ao branch Magalu.

## Testagem

- **Magalu Affiliate Link Builder**: função pura, testada isoladamente com casos determinísticos — URL com os parâmetros do afiliado original (deve sobrescrever, não duplicar nem manter os valores alheios), URL sem nenhum desses parâmetros ainda (deve adicionar todos).
- **Orquestrador TS** (`affiliateLink.ts`): testes unitários com mock do resultado do script, cobrindo os novos casos (`MAGALU_CREDENTIALS_MISSING`, sucesso com `marketplace: 'magalu'`), seguindo o mesmo padrão dos testes já existentes.
- **Script Playwright**: sem teste automatizado (mesma limitação já aceita pros outros três marketplaces). Validação manual com um link real do canal antes de considerar pronto.
- **Ponta a ponta**: uma execução real completa com um link Magalu real (link → post em rascunho no Shopify + redes sociais), incluindo checar no painel de afiliados do usuário que o clique/venda de teste aparece atribuído à conta dele — mesmo tipo de verificação que ficou pendente como critério de aceite real na feature do cupom "lista" do Mercado Livre.

## Riscos conhecidos

- **Allowlist de imagem** pros proxies de Story/TikTok (`ALLOWED_IMAGE_HOSTS`, em `story-image/route.tsx` e `tiktok-image-proxy/route.ts`) precisa incluir o domínio de CDN de imagem do Magalu — provavelmente `a-static.mlcdn.com.br` (padrão conhecido de terceiros), mas só confirmável na primeira extração bem-sucedida. Mesmo tipo de lacuna que já aconteceu com a Shopee (`susercontent.com` esquecido na primeira versão) e com a Amazon.
- **Seletor genérico pode não bastar.** Diferente da Amazon (que já se sabia de antemão que precisaria de seletor de preço específico), não há confirmação de que o fallback genérico funciona pro Magalu — só descobrimos testando ao vivo.
- **`partner_id`/`promoter_id` errados não geram erro nenhum do lado do Magalu** (o link continua funcionando, só sem crédito de comissão pro afiliado) — não há como validar programaticamente que os valores estão corretos, só checando manualmente no painel de afiliados depois.
- **Bloqueio anti-bot** — sem indício conhecido até agora (diferente da Amazon), mas só confirmável testando contra produtos reais.

## Próximos passos (fora deste documento)

Cupom de loja/categoria do Magalu via `magazinevoce.com.br` fica pra uma extensão futura, se e quando aparecer necessidade real (mesmo padrão já usado pro cupom "lista" do Mercado Livre, que foi tratado como sub-projeto separado). Os demais itens do roadmap original do MVP (gatilho via WhatsApp, geração de texto do post via LLM, migração pra arquitetura de fila assíncrona) continuam fora do escopo deste documento.
