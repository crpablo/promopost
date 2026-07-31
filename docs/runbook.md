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

Use um link de produto real do Mercado Livre. Esperado: resposta `200` com `{ "postUrl": "...", "facebook": {...}, "instagram": {...}, "tiktok": {...} }` — os campos `facebook`/`instagram`/`tiktok` vêm como `{ "ok": false, "error": "não configurado" }` se as respectivas variáveis (seções 10 e 11) ainda não estiverem configuradas. Ver seção 10.3 pro formato completo.

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

**Descoberto em validação real (2026-07-29):** o Business Manager exige que exista um **app** vinculado ao portfólio empresarial antes de deixar criar um Usuário do Sistema — não dá pra pular direto pro Usuário do Sistema como o passo 2 abaixo sugere isoladamente. Por isso o passo 0 abaixo vem primeiro.

0. Configurações do negócio > Contas > Apps > Adicionar/Criar app. Tipo "Negócios" serve — é só um container de autenticação, não precisa configurar nenhum produto de verdade. Em "Casos de uso", adiciona **"Gerenciar tudo na sua Página"** e **"Gerenciar mensagens e conteúdo no Instagram"**, e em cada um marca as permissões da lista abaixo (passo 5). **Não** complete o fluxo de "Configurar o login da empresa no Instagram" (é um OAuth interativo pra apps de terceiro — não é o que usamos aqui).
1. Acesse o Business Manager (business.facebook.com) da conta que já tem a Página do Facebook e o Instagram comercial conectados.
2. Vá em Configurações do negócio > Usuários > Usuários do sistema > Adicionar.
3. Crie um System User (papel Admin é o mais simples).
4. Em "Adicionar ativos": conecte a Página do Facebook e a conta do Instagram a esse System User com controle total (categoria "Páginas" e "Contas do Instagram") — **e também conecte o app criado no passo 0** (categoria "Apps", controle total). Sem isso, a tela de gerar token mostra "Nenhuma permissão disponível".
5. Gere um token de acesso pra esse System User, escolhendo o app do passo 0, com as permissões: `pages_manage_posts`, `pages_manage_engagement`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`. Duração: **"Nunca"** (não expira por tempo) — vai em `META_SYSTEM_USER_TOKEN`.

### 10.2 Descobrir os IDs

- **ID da Página:** aparece em Configurações da Página no Facebook, ou via `GET https://graph.facebook.com/v26.0/me/accounts?access_token=<token>` (lista as Páginas que o System User administra).
- **ID da conta do Instagram:** `GET https://graph.facebook.com/v26.0/<page-id>?fields=instagram_business_account&access_token=<token>`.

Configure `META_PAGE_ID` e `META_IG_BUSINESS_ACCOUNT_ID` na Vercel com os valores encontrados.

### 10.3 Teste manual

Depois do deploy, disparar o webhook normalmente (seção 6) com um link real do Mercado Livre e conferir na resposta os campos `facebook`/`instagram`:

```json
{
  "postUrl": "...",
  "facebook": { "ok": true, "postId": "..." },
  "instagram": { "ok": true, "postId": "..." },
  "tiktok": { "ok": true, "postId": "..." }
}
```

Conferir também que o post apareceu de fato na Página do Facebook e no perfil do Instagram, com a imagem do produto e a legenda com preço/cupom/link/hashtags.

### 10.4 Se algo falhar

O campo `facebook` ou `instagram` na resposta vem como `{ "ok": false, "error": "..." }` — o post do blog sai normalmente mesmo assim. O erro também fica nos logs da função (`console.error`). Erros comuns:
- Token revogado ou permissão removida no Business Manager — gere um novo token (seção 10.1).
- Imagem do produto inacessível pro fetcher da Meta — confira se a URL da imagem do Mercado Livre abre normalmente num navegador anônimo.
- **Já corrigidos no código, registrados aqui pra referência caso reapareçam:**
  - Facebook: `(#200) The permission(s) publish_actions are not available` — o token do Usuário do Sistema não posta direto na Página; `facebook.ts` já troca ele por um token de Página (`GET /{page-id}?fields=access_token`) antes de postar. Se esse erro voltar, o Usuário do Sistema pode ter perdido acesso à Página (confira seção 10.1, passo 4).
  - Instagram: `Media ID is not available` — o Instagram processa a imagem de forma assíncrona depois de criar o container; `instagram.ts` já espera o `status_code` virar `FINISHED` (até 10 tentativas, 2s entre cada) antes de publicar. Se esse erro voltar mesmo assim, a imagem pode ser grande/lenta demais pro Instagram buscar dentro desse tempo — considere aumentar `CONTAINER_POLL_MAX_ATTEMPTS`.

### 10.5 Stories do Instagram

O mesmo gatilho do feed também posta um Story (imagem do produto + preço/cupom desenhados sobre a foto, sem link nem legenda — a API do Instagram não suporta nenhum dos dois nesse tipo de mídia). Usa as mesmas variáveis `META_IG_BUSINESS_ACCOUNT_ID`/`META_SYSTEM_USER_TOKEN` já configuradas na seção 10.1, mais `WEBHOOK_BASE_URL` (já configurada na seção 9.3, reaproveitada aqui). Aqui especificamente `WEBHOOK_BASE_URL` precisa apontar pra um deploy genuinamente público: uma URL de preview da Vercel (que vem com Deployment Protection ligado por padrão) ou `localhost` falham silenciosamente, porque os servidores da Meta precisam conseguir buscar `/api/story-image` direto da internet pública.

A resposta do webhook ganha um terceiro campo, `story`, no mesmo formato de `facebook`/`instagram`:

```json
{
  "postUrl": "...",
  "facebook": {...},
  "instagram": {...},
  "story": { "ok": true, "postId": "..." },
  "tiktok": { "ok": true, "postId": "..." }
}
```

Pra conferir o resultado visual da imagem gerada antes de postar de verdade, abra direto no navegador: `https://promopost.vercel.app/api/story-image?imageUrl=<url da foto>&title=<nome>&price=<preço>&discountedPrice=<preço com desconto, opcional>&coupon=<cupom, opcional>` (parâmetros de query com URL-encoding).

Se `story` vier com erro: mesma tabela de causas prováveis da seção 10.4 (token/permissão, imagem inacessível) — mais um caso específico do Story: `WEBHOOK_BASE_URL não configurado` significa que essa variável (usada aqui pra montar a URL pública da imagem) está faltando.

## 11. TikTok (opcional, sub-projeto separado)

Cobre a postagem automática da mesma promoção como foto no TikTok, junto com o post do blog e das outras redes (ver `docs/superpowers/specs/2026-07-30-tiktok-posting-design.md`).

**Importante:** até o app passar pela auditoria da TikTok (seção 11.3), todo post sai como privado (`SELF_ONLY`) — só visível na própria conta. Isso é uma restrição da plataforma, não um bug.

### 11.1 Criar o app na TikTok

1. Acesse developers.tiktok.com, crie um app.
2. Adicione o produto "Content Posting API".
3. Anote o **Client Key** e o **Client Secret** — vão em `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET`.
4. Registre a URL de callback (`https://promopost.vercel.app/api/tiktok-oauth-callback`) como Redirect URI autorizada do app — vai em `TIKTOK_REDIRECT_URI`.
5. Configure a permissão (`scope`) `video.publish`.
6. **Verifique o nosso próprio domínio.** A TikTok só aceita `photo_images` (`PULL_FROM_URL`) de domínios verificados como propriedade sua — mesmo princípio do Google Search Console. Como as fotos de produto vêm originalmente do CDN do Mercado Livre (`mlstatic.com`, que não é nosso e não pode ser verificado), a foto é servida através da nossa própria rota `/api/tiktok-image-proxy` — é o **nosso** domínio (`promopost.vercel.app`, ou o domínio customizado do projeto, se houver) que precisa ser verificado, não o do Mercado Livre. Na área "Content Posting API" > "Domain Verification" do seu app, adicione esse domínio e siga o método de verificação que a TikTok oferecer no momento (arquivo em `/.well-known/` ou registro TXT no DNS — a interface deles muda; siga o passo a passo que aparecer). Sem isso, o `postToTikTok` falha com um erro de URL de imagem não permitida mesmo com tudo o mais configurado corretamente.

### 11.2 Autorizar a conta

**Nota sobre a ordem de configuração:** assim que `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET` estiverem configurados (o que já ativa o gate do TikTok no webhook), toda postagem vai reportar `tiktok: {ok:false, error:'Token do TikTok não configurado...'}` até você completar a autorização manual abaixo — isso é esperado, não um bug; o token só existe depois desse passo.

Depois de configurar `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` e `TIKTOK_REDIRECT_URI` na Vercel e fazer o deploy, monte e abra esta URL no navegador (troque `<client_key>` e `<redirect_uri codificado>`):

```
https://www.tiktok.com/v2/auth/authorize/?client_key=<client_key>&response_type=code&scope=video.publish&redirect_uri=<redirect_uri codificado>&state=promopost
```

Loga com a **conta secundária/comercial dedicada** (mesmo princípio do Telegram/Meta — não a conta pessoal principal) e autoriza. Você é redirecionado pra `/api/tiktok-oauth-callback`, que troca o código pelo primeiro par de tokens e salva no Blob automaticamente — a página mostra "Conta do TikTok autorizada com sucesso!" quando funciona. Não precisa rodar nenhum script local.

O token de acesso renova sozinho (o publisher renova antes de cada postagem se estiver perto de expirar). Só repita esse passo se o token de renovação expirar (365 dias) ou for revogado manualmente.

**Proteção contra re-autorização indevida:** como o `TIKTOK_CLIENT_KEY` aparece na própria URL de autorização (não é secreto), a rota `/api/tiktok-oauth-callback` recusa trocar um novo código se já existir um token salvo — devolve `409` com a mensagem "Já existe uma conta do TikTok autorizada...". Isso evita que alguém monte a própria URL, autorize com a conta dele, e sobrescreva o token legítimo. Se precisar mesmo reautorizar (token de renovação expirado/revogado, ou trocar de conta), apague manualmente o blob `tiktok-tokens.json` no Vercel Blob Store antes de repetir este passo.

### 11.3 Submeter o app pra auditoria

Na área "Content Posting API" do seu app no developers.tiktok.com, envie o app pra revisão quando quiser que os posts deixem de ser privados. Não é bloqueante pra usar a integração (os posts saem privados até lá) — pode submeter a qualquer momento, inclusive antes de configurar o resto.

### 11.4 Teste manual

Depois de autorizado (seção 11.2), disparar o webhook normalmente (seção 6) com um produto real e conferir o campo `tiktok` na resposta:

```json
{ "tiktok": { "ok": true, "postId": "..." } }
```

Conferir na conta do TikTok (o post vai estar privado, visível só logado nela).

### 11.5 Se algo falhar

- `tiktok: {ok:false, error:'não configurado'}` — faltam `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET`.
- `Token do TikTok não configurado` — nunca rodou o passo 11.2, ou o token de renovação expirou/foi revogado; repita o passo 11.2.
- `Falha ao renovar token do TikTok` — mesma causa acima.
- `Falha ao publicar no TikTok: picture_size_check_failed` (ou outro `fail_reason`) — a imagem do produto não passou nas checagens da TikTok; confira se a URL da imagem abre normalmente.
- `tiktok: {ok:false, error:'WEBHOOK_BASE_URL não configurado'}` — falta a variável `WEBHOOK_BASE_URL` (mesma usada pela seção 10.5), necessária pra montar a URL do `/api/tiktok-image-proxy`.
- Erro de URL de imagem não permitida vindo da própria TikTok — o domínio do passo 11.1.6 ainda não foi verificado (a verificação pode levar um tempo pra propagar depois de configurada).

## 12. Shopee (opcional, sub-projeto separado)

Cobre a captura automática de links da Shopee no mesmo canal Telegram já monitorado, publicando no blog e nas redes sociais igual já acontece com o Mercado Livre (ver `docs/superpowers/specs/2026-07-31-shopee-marketplace-design.md`).

Diferente do Mercado Livre, a Shopee **não exige sessão logada nem bootstrap manual** — só credenciais fixas de app de afiliado.

### 12.1 Obter as credenciais

1. Acesse affiliate.shopee.com.br, logado na conta de afiliado já aprovada.
2. Procure a seção **"Open API"** (pode estar em "Ferramentas" ou similar — a interface muda).
3. Gere (ou copie, se já existir) o **App ID** e o **Secret Key** — vão em `SHOPEE_APP_ID`/`SHOPEE_SECRET_KEY`.

### 12.2 Verificar o domínio da API

O código chama `https://open-api.affiliate.shopee.com.br/graphql`. Esse domínio foi inferido de documentação pública de terceiros (a documentação oficial da Shopee é escassa e majoritariamente atrás de login) — **confirme dentro do painel de Open API** se esse é o endpoint correto pra sua conta antes do primeiro teste real. Se for diferente, ajuste a URL em `src/lib/mercadolivre/generate-link.playwright.mjs` (procure por `open-api.affiliate.shopee`).

### 12.3 Teste manual

Depois de configurar `SHOPEE_APP_ID`/`SHOPEE_SECRET_KEY` na Vercel e fazer o deploy, disparar o webhook (seção 6) com um link de produto real da Shopee (ou um link de encurtador que resolva pra um) e conferir a resposta:

```json
{ "postUrl": "..." }
```

Se falhar, confira os logs (`vercel logs`) — o erro real da chamada assinada aparece no stderr do script (marcador `SHOPEE_API_ERROR`), incluindo a resposta de erro devolvida pela Shopee.

### 12.4 Se algo falhar

- `Variáveis de ambiente da Shopee ausentes: SHOPEE_APP_ID, SHOPEE_SECRET_KEY` — faltam as credenciais na Vercel; repita o passo 12.1.
- `Falha ao gerar link de afiliado da Shopee: SHOPEE_API_ERROR (...)` — o corpo do erro retornado pela Shopee aparece entre parênteses. Causas prováveis: assinatura incorreta (revise `calculateShopeeSignature` e o formato exato do header — a documentação pública pode ter mudado), domínio da API errado (repita o passo 12.2), ou timestamp fora da janela de validade (o request demorou demais entre calcular a assinatura e a Shopee recebê-la — improvável, mas possível sob rede lenta).
- `Produto não encontrado na página do Mercado Livre: PRODUCT_NOT_FOUND (...)` **para um link da Shopee** — apesar da mensagem mencionar "Mercado Livre" (herdada do código original, ainda não generalizada), esse erro também dispara pra produtos Shopee cujas meta tags não bateram com os seletores usados (`og:image`, `meta[itemprop="price"]`) — o formato exato da página da Shopee ainda não foi confirmado contra o site real; pode precisar ajustar os seletores em `generate-link.playwright.mjs`.
- Link não é reconhecido como Shopee (`MARKETPLACE_NOT_SUPPORTED`) mesmo sendo um link Shopee válido — confira se o hostname resolvido bate com `shopee.com.br` (subdomínios inclusive); domínios regionais diferentes (ex: `.co.id` de outros países) não são reconhecidos por design.
