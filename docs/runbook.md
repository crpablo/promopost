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
- O link recebido no webhook não precisa mais ser direto do Mercado Livre: o script navega até ele primeiro e segue qualquer redirect (HTTP normal ou client-side via JS, comum em encurtador tipo go.promozone.ai) antes de checar o domínio. Só depois de resolver o destino final é que valida se é ML e segue com scraping + geração de link. Um link de redirect que não leva a produto nenhum (ex: perfil social de outro afiliado) falha em `product_fetch` normalmente, não trava o sistema.

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

- Abrir a `postUrl` retornada — deve ser um artigo em **rascunho** no blog Shopify, com o texto no formato `[TÍTULO] por R$[PREÇO] — confira: [LINK_AFILIADO]` e a imagem do produto.
- Conferir no painel de afiliados do Mercado Livre que o link gerado (domínio `meli.la`) corresponde ao produto certo.
- Publicar o artigo manualmente no admin Shopify se o resultado estiver correto.

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

Além das que já existem (seção 1), configure: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION_BLOB_URL`, `TELEGRAM_TARGET_CHAT_ID`, `WEBHOOK_BASE_URL` (domínio de produção, ex: `https://promopost.vercel.app`), `CRON_SECRET` (Vercel gera automaticamente esse valor e envia no header da chamada do cron — configure o mesmo valor como env var do projeto).

### 9.4 Deploy e verificação do cron

Depois do deploy (`vercel deploy --prod`), confira em Project Settings > Cron Jobs se `/api/telegram-poll` aparece agendado a cada 3 minutos.

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
