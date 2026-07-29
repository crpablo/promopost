# PromoPost MVP — Runbook de validação

Checklist pra validar o fluxo completo depois de implementar todas as tasks do plano.

## 1. Configurar variáveis de ambiente na Vercel

- `WEBHOOK_SECRET` — qualquer string aleatória longa.
- `BLOB_READ_WRITE_TOKEN` — criar um Blob Store no dashboard Vercel (Storage > Blob) e copiar o token.
- `SHOPIFY_SHOP_DOMAIN` — ex: `sua-loja.myshopify.com`.
- `SHOPIFY_ADMIN_ACCESS_TOKEN` — criar um app customizado no admin Shopify com escopo `write_content`.
- `SHOPIFY_BLOG_ID` — GID do blog de destino (`gid://shopify/Blog/<id>`); pegue o `<id>` numérico na URL do blog no admin Shopify.
- `ML_SESSION_BLOB_URL` — preenchido no passo 2 abaixo.

**Nota sobre `@vercel/sandbox`:** requer autenticação — habilite OIDC no projeto Vercel (Project Settings > Security > Secure Backend Access) OU defina `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID` e `VERCEL_TOKEN` como variáveis de ambiente.

## 2. Bootstrap da sessão Mercado Livre

Rodar localmente (ver Task 9):

```bash
BLOB_READ_WRITE_TOKEN=<token> node scripts/bootstrap-session.mjs
```

Logar manualmente, confirmar, copiar a URL impressa pra `ML_SESSION_BLOB_URL` na Vercel.

Nota: `scripts/bootstrap-session.mjs` é o único caminho que escreve a sessão no Vercel Blob — não existe função `saveSession` no código da aplicação; o próprio script faz a chamada `put()` diretamente.

## 3. Seletores do Playwright (já confirmados contra o site real)

`src/lib/mercadolivre/generate-link.playwright.mjs` foi validado numa execução real em 2026-07-28. Ele faz DUAS coisas na mesma sessão de browser: extrai dado do produto (título/preço/imagem) direto do HTML da página, e gera o link de afiliado. Achados que valem registrar (caso o Mercado Livre mude o site e seja preciso reconfirmar):

- **A API pública `api.mercadolibre.com/items/{id}` não existe mais como pública** — passou a exigir OAuth (erro `403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES` pra qualquer chamada, confirmado em duas redes diferentes). Por isso os dados do produto vêm de scraping da própria página, não de uma API: `h1` pro título, `meta[itemprop="price"]` pro preço, `meta[property="og:image"]` pra imagem.
- A URL real do gerador de link é `https://www.mercadolivre.com.br/afiliados/linkbuilder#hub` (com o `#hub` — sem ele o roteamento da SPA não carrega o formulário). Ela só aparece assim pra contas já aprovadas no Programa de Afiliados.
- Campo de link: `textarea#url-0`.
- Botão: `<button>` com texto `Gerar`.
- Campo de resultado: `textarea#textfield-copyLink-1` (ler com `.inputValue()`, não `.innerText()` — é um textarea, não um texto solto).
- O link gerado usa o domínio **`meli.la`** (ex: `https://meli.la/1p5KcpX`), não `mercadolivre.com/sec/...` como se supunha antes de testar.
- **Importante:** o Mercado Livre bloqueia Chromium headless "puro" com uma página de erro genérica, mesmo com sessão válida — o script já usa um user-agent real, esconde `navigator.webdriver` e passa `--disable-blink-features=AutomationControlled` pra contornar isso. Sem esses três ajustes, a navegação falha por completo (não é problema de seletor).
- Links de catálogo do Mercado Livre (`/p/MLB...`) já testados e funcionam normalmente pra scraping + geração de link (diferente do que se temia antes de testar — o problema real era a API OAuth, não o formato do link).
- Existe um terceiro formato de ID: produto usado fica em `/up/MLBU<dígitos>` (prefixo "MLBU", não "MLB"). O parser aceita, mas o próprio Programa de Afiliados pode recusar gerar link pra produto usado ("Este URL não é permitido pelo Programa") — regra deles, não bug nosso.
- O link recebido no webhook não precisa mais ser direto do Mercado Livre: o script navega até ele primeiro e segue qualquer redirect (HTTP normal ou client-side via JS, comum em encurtador tipo go.promozone.ai) antes de checar o domínio. Só depois de resolver o destino final é que valida se é ML e segue com scraping + geração de link. Um link de redirect que não leva a produto nenhum (ex: perfil social de outro afiliado sem produto em destaque) falha em `product_fetch` normalmente, não trava o sistema.
- **Descoberto em validação real com o gatilho Telegram (2026-07-29):** o encurtador `go.promozone.ai/mercadolivre/...` usado pelo canal "Promozone Oficial" não leva direto ao produto — ele resolve pra a página de **Perfil Social** do próprio afiliado no Mercado Livre (`mercadolivre.com.br/social/...`), que tem um card com o produto em destaque e um botão/link **"Ir para produto"**. O script detecta esse botão (`getByRole('link', { name: /ir para produto/i })`) e segue o `href` dele antes de tentar extrair título/preço/imagem — sem isso, todo link desse canal falhava com `PRODUCT_NOT_FOUND` (a página de perfil não tem `h1`/`meta[itemprop=price]` de produto, só o `og:image` bate por coincidência). Se o Mercado Livre mudar o texto/formato desse botão, é aqui que precisa reajustar.

Se algo mudar no painel, repita esse processo: baixe a sessão salva (`ML_SESSION_BLOB_URL` + `BLOB_READ_WRITE_TOKEN`), abra a página com Playwright headless usando os mesmos ajustes anti-detecção acima, e inspecione os elementos via `evaluateAll` (mais confiável que abrir DevTools manualmente, já que a página normal também tem bloqueio de bot).

## 4. Rodar a suíte de testes local

```bash
npm test
npm run typecheck
```

Esperado: tudo verde.

## 5. Deploy

```bash
vercel deploy --prod
```

## 6. Teste ponta-a-ponta real

```bash
curl -X POST https://<seu-dominio>.vercel.app/api/webhook \
  -H "content-type: application/json" \
  -H "x-promopost-secret: $WEBHOOK_SECRET" \
  -d '{"link":"https://produto.mercadolivre.com.br/MLB-1234567890-produto-exemplo-_JM"}'
```

Use um link de produto real do Mercado Livre. Esperado: resposta `200` com `{ "postUrl": "..." }`.

## 7. Conferir o resultado

- Abrir a `postUrl` retornada — deve ser um artigo **já publicado** no blog Shopify (`isPublished: true`, decisão explícita de 2026-07-29 — antes era sempre rascunho), com preço/cupom/link no formato de `template.ts` e a imagem do produto.
- Conferir no painel de afiliados do Mercado Livre que o link gerado (domínio `meli.la`) corresponde ao produto certo.
- Como não há mais revisão antes de ir ao ar, uma extração errada do LLM ou um scraping de produto errado publica direto — vale acompanhar o blog com mais atenção nos primeiros dias.

## 8. Se algo falhar

A resposta de erro do webhook traz `{ "passo": "...", "erro": "..." }` indicando em qual dos 4 passos parou:

- `link_parse` — ou o link enviado nem é uma URL válida, ou (mais comum) o link foi seguido até o destino final e caiu fora do Mercado Livre. O sistema aceita link de encurtador/rastreador de terceiro (ex: go.promozone.ai, bit.ly) e segue o redirect (HTTP ou via JS) antes de validar o domínio — então esse erro só aparece se o destino final não for `mercadolivre.com.br`/`mercadolibre.com`.
- `product_fetch` — o script não achou título/preço/imagem na página do produto (`erro` inclui `PRODUCT_NOT_FOUND`). Confirme que o link abre normalmente e tem esses 3 dados visíveis.
- `affiliate_link` — a automação Playwright falhou. Se `erro` for `SESSION_EXPIRED`, repita o passo 2 (bootstrap). Se `erro` mencionar `x-vercel-oidc-token header is missing`, verifique a configuração de OIDC (veja seção 1). Caso contrário, use o texto do erro em si pra debugar e, se precisar de mais detalhe, rode o script `src/lib/mercadolivre/generate-link.playwright.mjs` localmente pra reproduzir a falha: antes de rodar, troque temporariamente o caminho hardcoded `/vercel/sandbox/session.json` pelo caminho local do arquivo de sessão baixado, e adicione `{ headless: false }` em `chromium.launch()` pra ver o browser (por padrão ele roda headless e lê a sessão só do caminho da sandbox).
- `shopify_publish` — a API do Shopify recusou a criação do artigo (token inválido, blog errado, rate limit).

## 9. Gatilho Telegram (opcional, sub-projeto separado)

Cobre a captura automática de promoção do Mercado Livre a partir de um grupo/canal do Telegram (ver `docs/superpowers/specs/2026-07-28-telegram-trigger-design.md`).

### 9.1 Credenciais do app Telegram

Acesse https://my.telegram.org, faça login com o número da **conta secundária** que vai rodar a automação, vá em "API Development Tools" e crie um app. Anote `api_id` e `api_hash` — vão em `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`.

### 9.2 Bootstrap da sessão + descoberta do chat alvo

```bash
TELEGRAM_API_ID=<id> TELEGRAM_API_HASH=<hash> BLOB_READ_WRITE_TOKEN=<token> node scripts/bootstrap-telegram-session.mjs
```

Loga com telefone + código recebido (+ senha de duas etapas, se a conta tiver). Ao final, o script imprime a URL da sessão salva (`TELEGRAM_SESSION_BLOB_URL`) e a lista de chats da conta com seus IDs — identifique o grupo/canal de promoções na lista e anote o ID (`TELEGRAM_TARGET_CHAT_ID`).

### 9.3 Configurar variáveis de ambiente na Vercel

Além das que já existem (seção 1), configure: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION_BLOB_URL`, `TELEGRAM_TARGET_CHAT_ID`, `WEBHOOK_BASE_URL` (domínio de produção, ex: `https://promopost.vercel.app`), `CRON_SECRET` (qualquer string aleatória longa, escolhida por você — é o valor que o disparador externo do passo 9.4 precisa enviar no header `Authorization`), `GROQ_API_KEY` (ver nota abaixo).

**Sobre o LLM de extração:** o padrão do projeto é o Groq (`GROQ_API_KEY`, gerada grátis em console.groq.com, sem pedir cartão), modelo `openai/gpt-oss-20b` — testado e confirmado com suporte real a saída estruturada. **Não usamos o Vercel AI Gateway aqui** porque, testado ao vivo em 2026-07-29: (1) o tier gratuito do Gateway bloqueia modelos pagos como `gpt-5.6-luna` mesmo com cartão cadastrado e saldo de crédito grátis disponível — exige um *top-up* real; (2) os modelos gratuitos do próprio Gateway (`poolside/laguna-s-2.1-free`, etc.) ou tomam rate limit quase imediato ou não suportam o `responseFormat` de saída estruturada que `generateObject` precisa. Se quiser usar o Gateway mesmo assim (ex: já tem saldo pago lá), dá pra trocar `src/lib/telegram/extractPromo.ts` de volta pro padrão `model: EXTRACTOR_MODEL_ID` (string simples) — mas exige o top-up.

### 9.4 Deploy e agendamento (serviço externo de cron)

**Importante:** contas Vercel Hobby só permitem cron jobs nativos com frequência diária — um agendamento a cada poucos minutos (necessário aqui) faz o deploy inteiro falhar com `Hobby accounts are limited to daily cron jobs`. Por isso `vercel.ts` não declara `crons`, e a rota `/api/telegram-poll` é disparada por um serviço externo gratuito de cron (ex: [cron-job.org](https://cron-job.org)), não pelo cron nativo da Vercel.

Depois do deploy (`vercel deploy --prod`), configure no serviço de cron escolhido:
- **URL:** `https://promopost.vercel.app/api/telegram-poll`
- **Método:** `GET`
- **Frequência:** a cada 3 minutos
- **Header:** `Authorization: Bearer <valor do CRON_SECRET>`

Se migrar pra Vercel Pro no futuro, basta devolver o bloco `crons` em `vercel.ts` e remover o serviço externo.

**Lock contra execuções concorrentes:** `/api/telegram-poll` usa um lock no Vercel Blob (`src/lib/telegram/lock.ts`, pathname `telegram-poll.lock`, expira sozinho depois de 5min) pra evitar que duas execuções sobrepostas (cron + disparo manual, ou duas do próprio cron) processem o mesmo lote de mensagens e publiquem posts duplicados — descoberto na prática em 2026-07-29 testando manualmente por `curl` enquanto o cron externo também rodava. Se a resposta vier com `"skippedConcurrent": true`, é porque já tinha outra execução em andamento — normal, sem necessidade de ação.

### 9.5 Teste manual

```bash
curl https://promopost.vercel.app/api/telegram-poll \
  -H "authorization: Bearer $CRON_SECRET"
```

Esperado: `200` com `{ "processedCount": N, "promoCount": N, "errors": [] }`. Mande uma mensagem de teste no grupo/canal de origem antes de rodar, no formato descrito no caso de uso original (nome do produto, de/por, cupom, link), e confira se um novo rascunho aparece no blog Shopify depois.

### 9.6 Se algo falhar

- Erro de conexão/autenticação do Telegram na rota do cron — a sessão pode ter expirado; repita o passo 9.2.
- `processedCount: 0` mesmo com mensagem nova no grupo — confira se `TELEGRAM_TARGET_CHAT_ID` é o chat certo, e se a API do GramJS usada em `src/app/api/telegram-poll/route.ts` bate com a versão instalada (ver nota na Task 7 do plano de implementação) — pode precisar ajustar nomes de método/campo depois de testar contra a conta real.
- Mensagem processada mas sem post gerado — confira o campo `errors` da resposta do cron; o texto ali indica se foi falha de extração (LLM) ou do webhook (mesma tabela de erros da seção 8).

## 10. Instagram e Facebook (opcional, sub-projeto separado)

Cobre a postagem automática da mesma promoção no Facebook e no Instagram, junto com o post do blog (ver `docs/superpowers/specs/2026-07-29-instagram-facebook-posting-design.md`).

### 10.1 Gerar o token System User

1. Acesse o Business Manager (business.facebook.com) da conta que já tem a Página do Facebook e o Instagram comercial conectados.
2. Vá em Configurações do negócio > Usuários > Usuários do sistema > Adicionar.
3. Crie um System User (papel Admin é o mais simples).
4. Em "Adicionar ativos", conecte a Página do Facebook e a conta do Instagram a esse System User, com controle total.
5. Gere um token de acesso pra esse System User com as permissões: `pages_manage_posts`, `pages_manage_engagement`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`. Esse token não expira por tempo — vai em `META_SYSTEM_USER_TOKEN`.

### 10.2 Descobrir os IDs

- **ID da Página:** aparece em Configurações da Página no Facebook, ou via `GET https://graph.facebook.com/v26.0/me/accounts?access_token=<token>` (lista as Páginas que o System User administra).
- **ID da conta do Instagram:** `GET https://graph.facebook.com/v26.0/<page-id>?fields=instagram_business_account&access_token=<token>`.

Configure `META_PAGE_ID` e `META_IG_BUSINESS_ACCOUNT_ID` na Vercel com os valores encontrados.

### 10.3 Teste manual

Depois do deploy, disparar o webhook normalmente (seção 6) com um link real do Mercado Livre e conferir na resposta os campos `facebook`/`instagram`:

```json
{ "postUrl": "...", "facebook": { "ok": true, "postId": "..." }, "instagram": { "ok": true, "postId": "..." } }
```

Conferir também que o post apareceu de fato na Página do Facebook e no perfil do Instagram, com a imagem do produto e a legenda com preço/cupom/link/hashtags.

### 10.4 Se algo falhar

O campo `facebook` ou `instagram` na resposta vem como `{ "ok": false, "error": "..." }` — o post do blog sai normalmente mesmo assim. O erro também fica nos logs da função (`console.error`). Erros comuns:
- Token revogado ou permissão removida no Business Manager — gere um novo token (seção 10.1).
- Imagem do produto inacessível pro fetcher da Meta — confira se a URL da imagem do Mercado Livre abre normalmente num navegador anônimo.
