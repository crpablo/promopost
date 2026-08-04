# PromoPost — Publicar cupons "lista" do Mercado Livre

## Contexto e motivação

Mensagens de cupom de loja/categoria inteira (sem produto único vinculado — ex: "Cupom válido em Cuidados com a Pele", ou o exemplo real trazido pelo usuário: "NOVO CUPOM MERCADOLIVRE / LIVROSJOGOSRELAMPAGO 20% OFF em compras acima de R$ 59,00 / Desconto máximo de R$ 30 / Ative pelo link: mercadolivre.com.br/social/promozonevip/lists") vêm do canal do Telegram com um link pra página de listas curadas do afiliado (`/social/{handle}/lists`) em vez de um produto — porque não existe um produto único pra linkar.

Isso já foi detectado corretamente desde 2026-07-31 (ver memória `promopost-ml-lists-link-bug`): o script Playwright reconhece esse padrão de URL depois de resolver o redirect e reporta `PRODUCT_LIST_LINK` em vez do genérico `PRODUCT_NOT_FOUND`. Mas a decisão tomada na época foi **descartar** essas promoções — nada é publicado, em canal nenhum. Este documento muda essa decisão: agora esses cupons são publicados como um post próprio, sem produto, em vez de descartados.

## Escopo deste documento

**Dentro do escopo:**
- Reconhecer cupons "lista" do **Mercado Livre** (o único marketplace onde esse padrão foi confirmado até agora) e publicar um post específico pra esse formato, em vez de descartar.
- Extrair, quando disponíveis na própria mensagem do Telegram, os detalhes estruturados do desconto: percentual, valor mínimo de compra, desconto máximo.
- Publicar esse post em **todos os canais já suportados** (Shopify, Facebook, Instagram feed, Instagram Story*, TikTok, grupos do Telegram) — usando uma imagem genérica de cupom (sem foto de produto) com um selo de texto identificando o marketplace.

  *Nota: o Story hoje é construído a partir de dados brutos do produto (`buildStoryImageUrl`, que exige `imageUrl`/`title`/`price`) — pra cupom, ele passa a usar a mesma imagem genérica de cupom das outras redes, com o texto do cupom no lugar do título/preço do produto.

**Fora do escopo (decisões já tomadas neste brainstorm):**
- **Shopee e Amazon.** O padrão de "cupom sem produto único" só foi confirmado até agora no Mercado Livre. Se aparecer um caso real desses marketplaces, isso vira um sub-projeto próprio, com sua própria detecção (o padrão de URL `/social/{handle}/lists` é específico do Mercado Livre — Shopee e Amazon precisariam de detecção equivalente própria, ainda não observada).
- **Logo oficial do Mercado Livre na imagem.** Decisão explícita do usuário: em vez da logo de verdade (que exigiria providenciar um arquivo de imagem oficial), a imagem usa um selo de texto estilizado com a cor característica da marca — mais simples de manter, sem dependência de asset externo.
- **Deduplicação de cupom repetido.** Se o mesmo cupom aparecer de novo no canal (reenvio, repost de outro afiliado), publica de novo — sem detecção de duplicata por ora. Mesmo raciocínio já usado outras vezes neste projeto: não pré-construir proteção sem ver o problema acontecer de verdade.
- **Extração de categoria/produto a partir do nome do cupom.** O código do cupom (ex: `LIVROSJOGOSRELAMPAGO`) às vezes sugere uma categoria pelo nome, mas isso não é confiável o bastante pra virar dado estruturado — o post usa só o que a mensagem realmente afirma.

## Por que este approach (arquitetura)

O mecanismo de detecção já existe e já é confiável em produção: o script Playwright resolve o link (inclusive atravessando encurtadores de terceiro) e, depois de resolvido, reconhece o padrão `/social/{handle}/lists`. A alternativa (classificar "é cupom de lista ou produto único" só pelo texto da mensagem, via LLM, sem nunca abrir o navegador) foi considerada e descartada — seria mais rápida, mas é lógica nova sem histórico de confiabilidade, contra um mecanismo que já está validado em produção desde 2026-07-31.

A mudança real de arquitetura é o que acontece **depois** da detecção: hoje ela vira `PRODUCT_LIST_LINK` → `InvalidLinkError` → o pipeline inteiro aborta (400, nada publicado). Agora vira um novo tipo de erro (`ListCouponError`, ao lado de `InvalidLinkError`/`ProductNotFoundError`/`SessionExpiredError` já existentes em `pipeline.ts`) — e o webhook, ao capturar especificamente esse erro, desvia pra um caminho de publicação de cupom em vez de reportar falha.

**O link de ativação usado no post é gerado pela nossa própria conta, não reaproveitado do afiliado que postou a mensagem original.** Descoberta importante: o gerador de link de afiliado do Mercado Livre (`mercadolivre.com.br/afiliados/linkbuilder#hub`, já usado hoje pro fluxo de produto) aceita qualquer URL do domínio deles — não é restrito a página de produto. Isso significa que a mesma automação já usada hoje (login com a sessão salva, colar a URL, clicar "Gerar") funciona igual pra página de lista (`/social/{handle}/lists`), só que sem precisar extrair título/preço/imagem (que não existem nesse tipo de página). O script Playwright passa a pular a extração de dado de produto pra esse caso e ir direto pro gerador de link, usando a própria URL da lista resolvida como entrada — o resultado é **nosso link de afiliado**, apontando pra mesma página de lista, mas creditando a conta do usuário em vez da conta de quem originalmente postou a mensagem no canal. `ListCouponError` carrega esse link já pronto (`affiliateLink`), não a URL crua da lista.

Os detalhes do desconto (percentual, valor mínimo, desconto máximo) **não podem vir do Playwright** — não existe página de produto pra raspar. Eles só existem no texto original da mensagem do Telegram, então precisam ser capturados na extração via LLM (`extractPromo.ts`) e transportados no corpo da chamada ao webhook desde o início — chegam independentes do resultado do pipeline, e ficam disponíveis assim que o `ListCouponError` é capturado.

As funções de publicação social (`postToFacebook`, `postToInstagram`, `postToTikTok`, `postToTelegramGroups`) já recebem só `imageUrl` + legenda (nunca dependeram de um objeto `Product` internamente) — não precisam de nenhuma mudança, só passam a ser chamadas com a imagem/legenda de cupom em vez de produto.

## Arquitetura

```
POST /api/webhook { link, coupon?, discountedPrice?, discountPercent?, minPurchaseValue?, maxDiscountValue? }
  → runPipeline(link, ...) tenta o fluxo normal de produto
      → fetchProductAndAffiliateLink → Playwright resolve o link
          → reconhece /social/{handle}/lists (detecção já existente)
          → pula a extração de título/preço/imagem (não existem nessa página)
          → gera link de afiliado próprio pra essa URL de lista (reaproveita
            o gerador de link já usado pro fluxo de produto)
          → lança ListCouponError(affiliateLink)   [NOVO — antes era InvalidLinkError/PRODUCT_LIST_LINK]
  → webhook captura ListCouponError especificamente:
      → publishCouponPromo({ coupon, discountPercent, minPurchaseValue, maxDiscountValue, affiliateLink, marketplace: 'mercadolivre' })
          → buildCouponCaption(...)              — NOVO, sem Product
          → buildCouponImageUrl(...)             — NOVO, aponta pra /api/coupon-image
          → publishCouponArticle(...)             — NOVO, Shopify sem Product
          → postToFacebook/Instagram/TikTok/TelegramGroups(imagemDeCupom, legendaDeCupom)
              — reaproveitados sem mudança
      → retorna { postUrl, facebook, instagram, story, tiktok, telegram } — mesmo formato de sempre
  → se não for ListCouponError, comportamento inalterado (PipelineError normal, produto publicado normalmente)
```

## Componentes

| Componente | Responsabilidade | Depende de |
|---|---|---|
| **`extractPromo.ts`** (modificado) | Schema/prompt ganham `discountPercent`, `minPurchaseValue`, `maxDiscountValue` (opcionais, best-effort a partir do texto da mensagem). | LLM (Groq, já usado) |
| **`poller.ts` / `telegram-poll/route.ts`** (modificado) | Repassa os 3 campos novos no corpo da chamada ao webhook, junto com `coupon`/`discountedPrice` já existentes. | `extractPromo` |
| **`pipeline.ts`** (modificado) | Novo `ListCouponError`, ao lado das classes de erro já existentes. | — |
| **`generate-link.playwright.mjs`** (modificado) | Detecção do padrão `/social/{handle}/lists` sem mudança — mas em vez de emitir `PRODUCT_LIST_LINK` e sair, pula a extração de produto e reaproveita o gerador de link de afiliado (extraído pra uma função compartilhada, já que agora é chamado de dois lugares: fluxo normal de produto e este novo caso) pra gerar um link próprio pra URL da lista. Emite um formato de saída novo e distinto (`isListCoupon: true`, sem `title`/`price`/`imageUrl`). | — |
| **`affiliateLink.ts`** (modificado) | Reconhece o novo formato de saída (`isListCoupon: true`) e lança `ListCouponError(affiliateLink)` em vez de retornar `AffiliateResult`. | `pipeline.ts` |
| **`src/lib/content/couponTemplate.ts`** (novo) | `buildCouponCaption(...)` (legenda genérica de cupom) e `buildCouponArticleText(...)` (título+corpo pro Shopify) — funções puras, sem `Product`. | — |
| **`src/app/api/coupon-image/route.tsx`** (novo) | Gera a imagem genérica de cupom via `next/og` (mesma tecnologia do `/api/story-image`) — fundo com cor da marca, selo de texto do marketplace, código do cupom, percentual/valores quando disponíveis. Bem mais simples que o Story: não busca nem converte foto de produto nenhuma. | `next/og` (já usado) |
| **Webhook / `route.ts`** (modificado) | Captura `ListCouponError` especificamente e desvia pro caminho de publicação de cupom, reaproveitando os publishers sociais já existentes. Ganha `buildCouponImageUrl(...)` como função privada interna, no mesmo padrão já usado por `buildStoryImageUrl`/`buildTikTokImageProxyUrl` (também privadas, também dentro deste arquivo). | Todos acima |

## Fluxo de dado

```
Mensagem Telegram → extractPromo (LLM) → { isPromo, link, coupon, discountedPrice,
                                             discountPercent, minPurchaseValue, maxDiscountValue }
  → poller → POST /api/webhook (todos os campos no corpo)
  → runPipeline tenta fluxo de produto normal
      → se resolver pra /social/{handle}/lists → gera link de afiliado próprio
        pra essa URL → ListCouponError(affiliateLink)
  → webhook captura o erro, monta o post de cupom usando os campos do corpo
    original (coupon/discountPercent/minPurchaseValue/maxDiscountValue) mais o
    affiliateLink que veio no próprio erro — não do resultado do pipeline, que
    não existe nesse caminho (sem produto)
  → publica: Shopify (artigo sem produto), Facebook/Instagram/Story/TikTok/Telegram
    (imagem genérica de cupom + legenda de cupom)
```

## Tratamento de erro

- **Cupom sem percentual/valores estruturados** — `discountPercent`/`minPurchaseValue`/`maxDiscountValue` ficam `null`; `buildCouponCaption`/`buildCouponImageUrl`/`buildCouponArticleText` omitem essas linhas graciosamente, publicando só com o código do cupom e o link de ativação.
- **Link da lista não resolve mais** (removido, expirado) — mesmo tratamento de erro que já existe hoje pra link quebrado (o Playwright já reporta esse tipo de falha antes de chegar a reconhecer o padrão de lista); não tenta publicar cupom nenhum.
- **Gerador de link de afiliado falha pra essa URL** (sessão expirada, ou o gerador rejeita/não aceita URL de lista — ver Riscos conhecidos) — mesmo tratamento de erro que já existe hoje pra falha do gerador no fluxo de produto (`SESSION_EXPIRED` ou erro genérico); não publica cupom nenhum, reporta falha normalmente.
- **Sem `coupon` extraído** (mensagem confusa, LLM não capturou nem o código) — trata como falha de extração, mesmo caminho já existente hoje pra mensagens malformadas (não chega a virar webhook call).

## Testagem

- **`buildCouponCaption`/`buildCouponArticleText`**: funções puras, testadas isoladamente com casos determinísticos — todos os campos presentes, percentual/valores ausentes, cupom sem nenhum detalhe estruturado.
- **`/api/coupon-image`**: testado no mesmo padrão já usado em `/api/story-image` (parâmetros mockados, sem gerar PNG de verdade no teste).
- **Webhook**: teste de integração cobrindo o novo desvio — `fetchProductAndAffiliateLink` mockado pra rejeitar com `ListCouponError`, confirmando que a resposta publica o cupom (chama os publishers sociais com a imagem/legenda certas) em vez de retornar erro.
- **Sem teste automatizado pra detecção via Playwright em si** — mesma limitação já aceita pro resto do scraping deste projeto. Validação manual com uma mensagem de cupom real antes de considerar pronto (o exemplo trazido pelo usuário já serve como caso de teste real).

## Riscos conhecidos

- **Comportamento do gerador de link de afiliado pra uma URL que não é de produto é desconhecido.** O gerador (`mercadolivre.com.br/afiliados/linkbuilder#hub`) nunca foi testado com uma URL de página de lista — só com produto. Pode funcionar exatamente igual (gerando um link curto de rastreamento pra a mesma página), pode se comportar de forma inesperada, ou pode até rejeitar a URL. Só descobre testando de verdade — mesmo padrão de descoberta iterativa já visto com Amazon/TikTok neste projeto. O link real trazido pelo usuário (`mercadolivre.com.br/social/promozonevip/lists`) serve como primeiro caso de validação manual.
- **Extração dos valores numéricos (percentual, mínimo, máximo) pode ser inconsistente** — mensagens reais de cupom variam de formato entre afiliados diferentes (nem todas terão a estrutura limpa do exemplo trazido). Aceito como best-effort — o post se adapta ao que vier, sem exigir todos os campos.
- **Volume de posts pode aumentar bastante** — cupons de loja/categoria inteira podem ser mais frequentes no canal do que promoções de produto único (não há como saber sem observar de verdade). Se isso virar ruído demais nos canais sociais, é um ajuste de política a discutir depois — fora de escopo antecipar agora.

## Próximos passos (fora deste documento)

Se um padrão de cupom sem produto único aparecer de verdade na Shopee ou na Amazon, vira um sub-projeto próprio (detecção equivalente ao `/social/{handle}/lists`, específica de cada marketplace). O roadmap geral do projeto continua com: geração de texto do post via LLM, arquitetura de fila assíncrona, alertas de falha repetida.
