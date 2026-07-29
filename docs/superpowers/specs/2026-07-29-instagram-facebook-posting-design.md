# PromoPost — Postagem no Instagram e Facebook

## Contexto e motivação

O pipeline atual (spec `2026-07-27-promopost-mvp-design.md`, estendido por `2026-07-28-telegram-trigger-design.md`) captura promoções do Mercado Livre via Telegram e publica um post no blog Shopify. A visão original do projeto também incluía postar nas redes sociais. Este documento cobre o próximo sub-projeto: postar automaticamente no **Instagram e Facebook** a cada promoção capturada, reaproveitando o mesmo gatilho e os mesmos dados já usados pelo post do blog.

## Escopo deste documento

**Dentro do escopo:**
- Postagem automática de foto + legenda no Facebook (Página) e no Instagram (conta comercial conectada à mesma Página), via Graph API da Meta.
- Legenda no mesmo formato do post do blog (preço de/por, cupom, link) mais hashtags fixas.
- Autenticação via token de **System User** do Business Manager (o usuário já tem Business Manager configurado nesta conta).

**Fora do escopo (decisões já tomadas neste brainstorm):**
- **TikTok.** API completamente diferente (Content Posting API), fica pra um sub-projeto separado, depois deste.
- Atualização automática do link na bio do Instagram/Facebook — a legenda menciona "link na bio" como CTA genérico, mas a bio em si continua sendo mantida manualmente pelo usuário, sem automação.
- Stories, Reels ou qualquer formato que não seja post de feed com imagem estática.
- Retry automático de postagem que falhar (mesma filosofia do resto do projeto: sem retentativa automática).

## Por que este approach (arquitetura)

**Quando posta:** o gatilho é o mesmo do blog — o `POST /api/webhook` que já publica no Shopify passa a, depois do blog publicar com sucesso, tentar postar no Facebook e no Instagram. Não existe gatilho novo nem cron novo; é uma extensão do fluxo existente (Telegram → webhook → Mercado Livre → Shopify → **Instagram/Facebook**).

**Isolamento de falha:** publicar no Facebook ou no Instagram é **best-effort** — cada um roda em seu próprio try/catch. Uma falha em qualquer um dos dois (token expirado, imagem rejeitada, rate limit) não impede o post do blog, que já saiu antes, nem impede o outro post social de tentar. O resultado de cada rede social (sucesso ou erro) volta na resposta do webhook, sem retentativa automática — mesma filosofia de tratamento de erro já usada no resto do projeto.

**Autenticação:** a Graph API da Meta usa token de acesso de Página (Facebook) e de conta comercial do Instagram (que é acessada através da mesma Página conectada). Em vez do token de Página "simples" (gerado via Graph API Explorer, dura ~60 dias renovável), usamos um token de **System User** do Business Manager — feito especificamente para acesso permanente servidor-a-servidor, sem depender de nenhuma conta pessoal, sem expiração por tempo. Como a conta já tem Business Manager configurado, o custo de setup extra é baixo. Diferente da sessão do Mercado Livre (que expira e precisa de bootstrap via Playwright) e do userbot do Telegram (idem), aqui não há automação de login: o token é gerado uma única vez manualmente na interface do Business Manager e colado como variável de ambiente.

## Arquitetura

```
POST /api/webhook (já existente, estendido)
  → pipeline atual: parseItemId → fetchProductAndAffiliateLink → buildPostText → publishArticle (Shopify)
      (inalterado — se falhar aqui, a resposta é a mesma de hoje, nada social é tentado)
  → se o Shopify publicar com sucesso:
      → buildSocialCaption(product, affiliateLink, coupon?, discountedPrice?)
          → mesmo formato de/por + cupom + link do blog, em texto puro, + hashtags fixas
      → postToFacebook(product.imageUrl, caption) — best-effort, try/catch isolado
          → POST /{page-id}/photos (Graph API): 1 chamada, foto + legenda
      → postToInstagram(product.imageUrl, caption) — best-effort, try/catch isolado
          → POST /{ig-user-id}/media (cria container) → POST /{ig-user-id}/media_publish (publica)
  → resposta: { postUrl, facebook: {ok, postId?, error?}, instagram: {ok, postId?, error?} }
```

## Componentes

| Componente | Responsabilidade | Depende de |
|---|---|---|
| **Social Caption Builder** (`src/lib/social/caption.ts`) | Monta a legenda em texto puro: preço de/por (ou preço único), cupom, link, hashtags fixas. Espelha `buildPostText` mas sem HTML. | — |
| **Facebook Publisher** (`src/lib/social/facebook.ts`) | `postToFacebook(imageUrl, caption): Promise<{postId: string}>` — uma chamada à Graph API (`POST /{page-id}/photos`) com a imagem do produto (URL pública do CDN do ML) e a legenda. Lança erro em caso de falha (o chamador decide o que fazer). | `META_PAGE_ID`, `META_SYSTEM_USER_TOKEN` |
| **Instagram Publisher** (`src/lib/social/instagram.ts`) | `postToInstagram(imageUrl, caption): Promise<{postId: string}>` — cria o container de mídia e publica em duas chamadas sequenciais à Graph API. Lança erro se qualquer uma das duas etapas falhar. | `META_IG_BUSINESS_ACCOUNT_ID`, `META_SYSTEM_USER_TOKEN` |
| **Webhook + Pipeline** (`route.ts` — estendido) | Depois do Shopify publicar com sucesso, chama `postToFacebook` e `postToInstagram`, cada um em try/catch isolado, e inclui o resultado de cada um na resposta JSON. | Componentes acima |

## Tratamento de erro

- **Falha no pipeline do blog** (Mercado Livre, Shopify) — comportamento inalterado: erro no formato `{ passo, erro }` já existente, nenhuma tentativa de postar nas redes sociais.
- **Falha ao postar no Facebook e/ou Instagram** — não afeta o `postUrl` do blog nem o código de status HTTP da resposta (continua `200` se o blog publicou). O campo correspondente (`facebook` ou `instagram`) vem como `{ ok: false, error: "..." }`; o erro fica registrado via `console.error` (mesmo padrão do resto do projeto) pra permitir investigação manual. Sem retentativa automática.
- **Falha parcial no Instagram** (container criado mas publicação falha) — tratada como falha única de `postToInstagram` (a etapa que falhou determina a mensagem de erro), sem tentar reaproveitar o container numa chamada futura.

## Testagem

- **Social Caption Builder**: testes unitários cobrindo os mesmos casos de `buildPostText` (preço único, de/por com cupom, de/por sem cupom, escape de caracteres especiais) adaptados pro formato texto-puro + hashtags.
- **Facebook Publisher / Instagram Publisher**: testes unitários com `fetch` mockado (mesmo padrão de `publisher.test.ts`), cobrindo sucesso e diferentes falhas (erro de rede, resposta de erro da API, falha na segunda etapa do Instagram).
- **Webhook route**: a integração real (chamar a Graph API de verdade) não é testável automaticamente — mesma limitação já aceita para a automação Playwright do Mercado Livre e o userbot do Telegram.
- **Validação manual**: depois de gerar o token System User e configurar as variáveis de ambiente, disparar o webhook com um produto real e conferir que o post aparece de fato no Facebook e no Instagram, com imagem e legenda corretas.

## Riscos conhecidos

- **O token pode ser invalidado por ações fora do nosso controle** (revogação manual da permissão do app no Business Manager, ou a Meta detectar atividade suspeita) — raro, mas quando acontecer exige gerar um novo token manualmente na UI do Business Manager, documentado no runbook.
- **A imagem do produto vem do CDN do Mercado Livre** (`http2.mlstatic.com/...`), não é re-hospedada — assume-se que esse CDN é publicamente acessível pro fetcher da Meta. Se algum dia isso não for verdade (bloqueio por user-agent, etc.), a postagem falharia com erro claro da Graph API, capturado e registrado, sem afetar o blog.
- **Rate limits da Graph API** — não avaliados em profundidade nesta fase; dado o volume baixo de mensagens do canal de origem, não deve ser um problema prático, mas fica registrado como algo a observar na validação real.
- **Legenda idêntica nas duas redes** — Facebook renderiza o link como clicável, Instagram não; a mesma legenda em texto puro funciona nos dois casos (o link só não fica clicável no Instagram, como é o normal da plataforma).

## Próximos passos (fora deste documento)

Depois de validado este sub-projeto, o próximo (spec separado) cobre o **TikTok** — API de postagem diferente (TikTok Content Posting API), com seu próprio fluxo de autenticação e formato de conteúdo (vídeo, não foto — precisa decidir o que postar já que hoje só temos imagem estática do produto).
