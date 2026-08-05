# PromoPost — Magalu: produto a partir da mensagem do Telegram (sem scraping)

## Contexto e motivação

O Magalu foi integrado como quarto marketplace em `docs/superpowers/specs/2026-08-04-magalu-marketplace-design.md` (mergeado e deployado nesta mesma sessão), seguindo o mesmo padrão dos outros três: resolver o link, raspar título/preço/imagem da própria página do produto, gerar o link de afiliado. Validação ao vivo em produção, contra um link real do canal, mostrou que **a página de produto do Magalu está atrás do Akamai Bot Manager** — um bloqueio de nível de rede (fingerprint de TLS/HTTP), que rejeita a requisição com 403 antes mesmo do JavaScript rodar. Confirmado com `curl` puro, sem Playwright nenhum envolvido, de duas origens diferentes (a VPS e outra máquina) — não é um problema de IP específico, é o próprio bloqueio de bot da Akamai. As técnicas já usadas nos outros marketplaces (esconder `navigator.webdriver`, user-agent real) não têm efeito nesse tipo de proteção.

Como alternativa, o usuário observou que o canal do Telegram já traz tudo que precisamos: título, preço (de/por) e uma foto do produto, na própria mensagem — não precisamos visitar a página do Magalu pra ter esses dados. Esse documento substitui a abordagem de scraping do Magalu (que nunca funcionou em produção) por uma abordagem que monta o produto inteiramente a partir da mensagem do Telegram, sem visitar `magazineluiza.com.br` em nenhum momento.

A foto anexada às mensagens desse canal específico vem com uma marca d'água de outro divulgador (selo de avaliação + `@promozoneoficial`) sempre na mesma posição (confirmado pelo usuário com múltiplos exemplos reais) — temos que cobrir essa marca antes de publicar, senão estaríamos promovendo a marca de outro canal nos nossos próprios posts.

## Escopo deste documento

**Dentro do escopo:**
- `extractPromo.ts` ganha dois campos novos: `title` (título do produto) e `originalPrice` (o preço "DE", quando presente na mensagem).
- Download da foto anexada à mensagem do Telegram (via `client.downloadMedia`), só quando a mensagem já foi identificada como link do Magalu — nunca pros outros marketplaces.
- Cobertura da marca d'água: composição de um retângulo preto com o texto "@tobiestore" na posição já confirmada pelo usuário, usando `sharp`.
- Uma rota nova (`/api/telegram-media`) pra servir essa foto tratada publicamente.
- Um atalho no webhook: quando o link é do Magalu, monta o `Product` direto a partir de `title`/`originalPrice`/`discountedPrice`/`photoUrl` do corpo da requisição — **não chama mais o script Playwright pra esse marketplace**.
- `buildMagaluAffiliateLink` migra de dentro do script Playwright (`generate-link.playwright.mjs`) pra um módulo TypeScript puro — não depende mais de navegador, então não faz sentido mais viver lá.
- Remoção do código morto: a detecção `isMagalu`/checagem de credenciais/branch de geração de link que foram adicionados dentro do script Playwright na integração anterior nunca vão rodar (o webhook intercepta o Magalu antes de chamar o script) — removidos.
- Limpeza: depois de publicar (sucesso ou falha), o arquivo da foto tratada é apagado do disco — não fica guardado sem necessidade.

**Fora do escopo:**
- Cupom de loja/categoria do Magalu via `magazinevoce.com.br` — segue de fora, mesma decisão já tomada no spec anterior. Se um dia for implementado, provavelmente seguirá o mesmo padrão baseado em mensagem descrito aqui (o Akamai bloqueia a página de loja também), não o padrão de scraping.
- Detecção automática/dinâmica da posição da marca d'água — a posição é fixa (confirmada pelo usuário), hardcoded nas coordenadas de composição. Se o bot que gera essas imagens mudar o template, precisa de ajuste manual.
- Retry ou fila se o download da foto falhar — se falhar, a mensagem é tratada como erro (mesmo padrão dos outros marketplaces), sem novo mecanismo de reprocessamento.

## Arquitetura

```
Telegram poll (cron */15min)
  → fetchNewMessages(afterId)
      → pra cada mensagem: extractPromo(text) [LLM]
          → agora também extrai title, originalPrice
      → se extraction.link é do Magalu (magazineluiza.com.br):
          → downloadMessagePhoto(messageId)
              → client.downloadMedia(message) [teleproto]
              → coverWatermark(buffer) [sharp: composita retângulo
                preto + "@tobiestore" na posição fixa confirmada]
              → salva em DATA_DIR/telegram-media/{messageId}.jpg
              → devolve photoUrl = WEBHOOK_BASE_URL + /api/telegram-media?id={messageId}
      → callWebhook({ link, coupon, discountedPrice, discountPercent,
                       minPurchaseValue, maxDiscountValue,
                       title, originalPrice, photoUrl })

POST /api/webhook
  → se isMagaluLink(body.link):
      → exige body.title e body.photoUrl (senão 400)
      → product = {
          title: body.title,
          price: body.originalPrice ?? body.discountedPrice,
          imageUrl: body.photoUrl,
          marketplace: 'magalu',
        }
      → checa MAGALU_PARTNER_ID / MAGALU_PROMOTER_ID (senão 500)
      → affiliateLink = buildMagaluAffiliateLink(body.link, partnerId, promoterId)
      → buildPostText / publishArticle (Shopify) / postToSocialNetworks
        — MESMO fluxo normal de produto já usado pros outros marketplaces,
        não é o fluxo especial de cupom do ML
      → finally: deleteFile(`telegram-media/{messageId}.jpg`)
  → senão: fluxo já existente (runPipeline → script Playwright)
```

## Componentes

| Componente | Responsabilidade | Depende de |
|---|---|---|
| **`extractPromo.ts`** (modificado) | Prompt ganha instrução pra extrair `title` e `originalPrice` (a "DE") do texto da mensagem, além dos campos já existentes. | LLM (Groq) |
| **`src/lib/magalu/affiliateLink.ts`** (novo) | `isMagaluLink(link: string): boolean` (host `magazineluiza.com.br`) e `buildMagaluAffiliateLink(url, partnerId, promoterId): string` (mesma lógica pura já implementada, só migrada de dentro do script Playwright). | — |
| **`src/lib/magalu/photoOverlay.ts`** (novo) | `coverWatermark(buffer: Buffer): Promise<Buffer>` — composita um retângulo preto com "@tobiestore" na posição fixa confirmada sobre a imagem, devolve JPEG. Função pura de transformação de imagem (recebe buffer, devolve buffer), sem I/O de rede nem disco. | `sharp` |
| **`src/lib/storage/localStore.ts`** (modificado) | Ganha `writeBufferFile(filename, buffer)` — mesmo padrão de `writeTextFile`/`writeJsonFile`, mas cria o diretório completo do caminho (suporta subpastas como `telegram-media/`). `deleteFile` já existe, reaproveitado sem mudança. | — |
| **`src/app/api/telegram-media/route.ts`** (novo) | `GET /api/telegram-media?id={messageId}` — lê `DATA_DIR/telegram-media/{id}.jpg` e serve como `image/jpeg`. Valida que `id` é um inteiro positivo (mesmo formato de ID de mensagem do Telegram) antes de tocar o disco, pra não permitir path traversal. Pública, sem segredo — mesmo padrão de `/api/coupon-image`. | `localStore.ts` |
| **`src/app/api/telegram-poll/route.ts`** (modificado) | `fetchNewMessages` ganha a checagem `isMagaluLink` + a chamada de download/composição/salvamento, condicionada a essa checagem. Nova função `downloadMessagePhoto(client, message)`. | teleproto, `photoOverlay.ts`, `localStore.ts` |
| **`src/lib/telegram/poller.ts`** (modificado) | `PollerDeps` ganha `downloadMessagePhoto: (messageId: number) => Promise<string \| null>`. `runPoll` chama essa dependência só quando `isMagaluLink(extraction.link)`, e repassa `title`/`originalPrice`/`photoUrl` no corpo do `callWebhook`. | `magalu/affiliateLink.ts` (só a função `isMagaluLink`) |
| **`src/app/api/webhook/route.ts`** (modificado) | `POST` ganha um atalho no início: se `isMagaluLink(body.link)`, monta o produto direto da mensagem (sem chamar `runPipeline`), gera o link via `buildMagaluAffiliateLink`, publica pelo fluxo normal de produto, e limpa o arquivo da foto num `finally`. | `magalu/affiliateLink.ts` |
| **`generate-link.playwright.mjs`** (modificado) | Remove a detecção `isMagalu`, a checagem de credenciais e o branch de geração de link — nunca mais alcançados, já que o webhook intercepta o Magalu antes de chegar aqui. | — |
| **`affiliateLink.ts`** (mercadolivre, modificado) | Remove o mapeamento de `MAGALU_CREDENTIALS_MISSING` (stderr não é mais emitido, o script nunca mais processa link do Magalu) e a passagem de `MAGALU_PARTNER_ID`/`MAGALU_PROMOTER_ID` como env do processo filho. O branch `parsed.marketplace === 'magalu'` no mapeamento de retorno também é removido — esse valor nunca mais vem do script. | — |

## Fluxo de dado

Cobrindo os dois cenários possíveis pro campo `marketplace`:

- **Magalu** (`isMagaluLink(body.link)` verdadeiro): webhook monta `Product` direto do corpo da requisição, nunca chama `runPipeline`. Publica pelo mesmo `buildPostText`/`publishArticle`/`postToSocialNetworks` já usados pros outros três marketplaces — o `Product.marketplace = 'magalu'` já ativa a hashtag `#magalu` (feature anterior, sem mudança aqui).
- **Mercado Livre / Shopee / Amazon** (qualquer outro link): fluxo já existente, sem nenhuma mudança — `runPipeline` → `fetchProductAndAffiliateLink` → script Playwright.

## Tratamento de erro

- **Título ou foto ausentes na mensagem do Magalu** — se `isMagaluLink(body.link)` mas `body.title` ou `body.photoUrl` não vieram (a LLM não conseguiu extrair título, ou a mensagem não tinha foto anexada, ou o download falhou no poller), o webhook retorna 400 com uma mensagem clara. Sem fallback de scraping — se a mensagem não trouxer o que precisamos, não tem como completar.
- **Nenhum preço presente** (nem `originalPrice` nem `discountedPrice`) — 400, mesmo critério acima (não dá pra montar produto sem preço).
- **`MAGALU_PARTNER_ID`/`MAGALU_PROMOTER_ID` ausentes** — checado direto em TypeScript no início do branch do webhook (não mais via stderr de processo filho), retorna 500 com mensagem clara.
- **Falha no download da foto** (`downloadMessagePhoto` retorna `null` ou lança) — a mensagem é tratada como erro no poller, registrada em `errors` (mesmo padrão já usado pra falha de extração/webhook), sem novo mecanismo de retry.
- **Falha ao compor a marca d'água** (`sharp` lança) — mesmo tratamento acima, erro registrado, mensagem pulada.

## Testagem

- **`isMagaluLink`**: testes unitários determinísticos — host correto aceita, outros hosts (incluindo outros marketplaces) rejeitam, URL malformada não lança.
- **`buildMagaluAffiliateLink`**: os 3 testes já existentes (implementados na integração anterior) migram junto pro novo módulo, sem mudança de comportamento.
- **`coverWatermark`**: teste com `sharp` mockado (mesmo padrão já usado em `tiktok-image-proxy/route.test.ts`) — confirma que `composite()` é chamado com as coordenadas certas, sem precisar validar pixel real.
- **`localStore.writeBufferFile`**: teste unitário — grava e lê de volta via `readBufferFile`, confirma que cria subdiretório se não existir.
- **`/api/telegram-media`**: testes de validação de parâmetro (`id` ausente ou não-numérico → 400), arquivo inexistente → 404, arquivo existente → 200 com `content-type: image/jpeg` (mockando o filesystem).
- **`poller.ts`**: teste novo cobrindo o caminho condicional — mensagem com link do Magalu aciona `downloadMessagePhoto` e repassa `title`/`originalPrice`/`photoUrl` no corpo do webhook; mensagem de outro marketplace NÃO aciona `downloadMessagePhoto` nem inclui esses três campos.
- **`webhook/route.ts`**: testes novos cobrindo o atalho do Magalu — sucesso (produto montado da mensagem, publicado em todos os canais), 400 sem `title`/`photoUrl`, 500 sem credenciais — e um teste confirmando que o `finally` de limpeza do arquivo roda tanto no sucesso quanto na falha.
- **Ponta a ponta**: uma execução real completa com uma mensagem real do canal (webhook chamado manualmente com o corpo simulando o que o poller enviaria), confirmando que a imagem final tem a marca d'água coberta e que o link gerado tem os parâmetros do usuário, não os do divulgador original.

## Riscos conhecidos

- **Posição da marca d'água é hardcoded.** Se o bot que gera essas imagens no canal de origem mudar o template (tamanho, posição do selo), a cobertura para de bater — só descobrimos testando ao vivo, sem alarme automático pra esse tipo de desalinhamento.
- **Qualidade dos dados depende inteiramente da mensagem.** Diferente do scraping (que sempre pega o dado atual da página), título/preço vêm de como a pessoa que postou escreveu a mensagem — mensagens mal formatadas, com preço ambíguo ou título cortado, geram produto com dado ruim ou falham a extração.
- **Sem mecanismo de retenção/limpeza de fotos órfãs.** O `finally` cobre o caminho feliz (webhook processou a mensagem), mas se o processo cair no meio (crash do container, por exemplo) entre o download e a limpeza, o arquivo fica pra sempre em `DATA_DIR/telegram-media/`. Volume esperado é baixo o suficiente pra não ser urgente, mas não existe hoje uma rotina de limpeza por idade (como existe, por exemplo, pro lock do poller via `fileAgeMs`).
- **Banda de saída nova.** Ao contrário dos outros marketplaces (cujas imagens são buscadas pelas redes sociais direto do CDN do marketplace), a foto do Magalu passa a ser servida pela própria VPS — bandwidth extra que não existia antes, esperado ser pequeno dado o volume do canal.

## Próximos passos (fora deste documento)

Cupom de loja/categoria do Magalu (`magazinevoce.com.br`) segue sem data, condicionado a esse padrão baseado em mensagem se algum dia for implementado. Uma rotina de limpeza por idade pra `DATA_DIR/telegram-media/` (cobrindo o caso de crash no meio do processamento) pode valer a pena se o volume crescer, mas não é necessária agora.
