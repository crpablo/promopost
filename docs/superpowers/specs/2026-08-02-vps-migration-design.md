# PromoPost — Migração da Vercel para VPS (Hostinger)

## Contexto e motivação

O PromoPost roda hoje inteiramente na Vercel: Functions (Next.js App Router), Vercel Sandbox (Playwright, pra resolver links e fazer scraping do Mercado Livre/Shopee) e Vercel Blob (sessões, cursor do poller, tokens do TikTok). Em 3 dias de uso intenso (30/07–02/08), a fatura acumulou **$17,06**, dos quais **$14,51 (85%) foram só "Snapshot Storage"** do Vercel Sandbox — o custo de armazenar a imagem da sandbox (Chromium + dependências de sistema, reinstalados via `onCreate` a cada sandbox nova) pra reuso rápido entre chamadas. Isso bateu o crédito mensal do plano Pro ($20) quase todo num único dia de trabalho, um custo estrutural do modelo serverless-com-sandbox-efêmera que não escala bem pro padrão de uso deste projeto (poucas centenas de execuções por dia, cada uma precisando de um Chromium completo).

Este documento cobre a migração da aplicação inteira pra um VPS próprio (Hostinger KVM1, ~1 vCPU/4GB), eliminando a dependência de Sandbox (Chromium passa a viver instalado permanentemente na imagem Docker, sem reinstalação por chamada) e de Blob (dados persistidos em disco local do próprio VPS).

No momento da escrita deste documento, a aplicação já está parada (a conta Vercel foi rebaixada de Pro pra conter custo, e o cron parou de funcionar em consequência) — não há posts em produção acontecendo, o que remove a pressão de manter os dois ambientes rodando em paralelo por muito tempo.

## Escopo deste documento

**Dentro do escopo:**
- Empacotar a aplicação Next.js existente (rotas, pipeline, lib) num container Docker autocontido, incluindo Chromium/Playwright já instalado na imagem.
- Substituir os 5 módulos que hoje falam com `@vercel/blob` (sessão Mercado Livre, sessão Telegram, cursor do poller, tokens do TikTok, lock do poller) por um módulo único de storage em arquivo local, preservando as mesmas assinaturas de função.
- Substituir `fetchProductAndAffiliateLink` (hoje cria uma Vercel Sandbox por chamada) por execução local do mesmo script Playwright, dentro do próprio container.
- Provisionar o VPS do zero: Ubuntu, Docker, nginx + certbot (TLS), firewall básico (ufw), domínio já existente do usuário apontado via DNS.
- Runbook de deploy manual (`git pull && docker compose up -d --build`, mesmo padrão do `vercel deploy --prod` de hoje) e de agendamento (crontab do host chamando `telegram-poll` a cada 15min, substituindo o cron-job.org externo).
- Backup simples do diretório de dados (`tar` diário local).
- Plano de cutover: validar tudo rodando no VPS antes de desligar o cron da Vercel e apontar de vez os callbacks externos (TikTok redirect URI) pro novo domínio.

**Fora do escopo (decisões já tomadas neste brainstorm):**
- **CI/CD automatizado.** Deploy continua manual via SSH, como já é hoje na Vercel (`vercel deploy --prod` manual). Automatizar fica pra um projeto futuro, se necessário.
- **Alta disponibilidade / múltiplos nós.** Um único VPS, sem redundância de infraestrutura — aceitável pro volume atual do projeto.
- **Storage externo (S3-compatible, etc).** Os dados persistidos (sessões, cursor, tokens) somam poucos KB — disco local do próprio VPS é suficiente, sem necessidade de um serviço de storage separado.
- **Migração de dados existentes do Blob.** Como a aplicação já está parada e as sessões podem ser regeneradas via os scripts de bootstrap já existentes, o plano assume bootstrap novo no VPS em vez de copiar o conteúdo atual do Blob (ver "Riscos conhecidos" pra alternativa, se o usuário preferir tentar preservar a sessão do Mercado Livre já logada).
- **Mudança de lógica de negócio.** Pipeline, regras de extração, templates de post, nada disso muda — é puramente uma migração de infraestrutura.
- **Descomissionamento da conta Vercel.** O projeto continua existindo na Vercel (só desativado/sem cron), como fallback frio.

## Por que este approach (arquitetura)

**O desafio central:** a Vercel cobra por dois recursos que este projeto usa de um jeito estruturalmente caro pro modelo serverless: (1) Sandbox efêmera que reinstala Chromium + dependências de sistema a cada criação, gerando um snapshot pesado guardado e cobrado continuamente; (2) Blob, cujas operações "Advanced" (`list()`) têm cota mensal baixa no Hobby e já causaram uma suspensão de conta neste projeto (ver `promopost-blob-suspended-incident.md`).

**A decisão:** um VPS sempre ligado resolve os dois problemas pela raiz, não por otimização incremental:
- **Sandbox → processo local.** Num container que fica de pé o tempo todo, o Chromium é instalado **uma vez**, na build da imagem Docker — não a cada execução. `fetchProductAndAffiliateLink` deixa de criar/gerenciar uma Sandbox remota e passa a rodar o mesmo script Playwright como um subprocesso local (`child_process.execFile`), na mesma máquina.
- **Blob → arquivo local.** Um VPS tem disco persistente de verdade (diferente de uma Function serverless, que não garante isso) — os 5 módulos que hoje leem/escrevem no Blob passam a ler/escrever em arquivos num diretório fixo, sem custo por operação, sem cota.
- **Cron externo → crontab do host.** Já que o servidor fica ligado 24/7 (diferente de Functions, que só existem durante a invocação), não há mais motivo pra depender de um serviço terceiro (cron-job.org) só pra "acordar" a aplicação periodicamente — o próprio host agenda a chamada.

Nenhuma dessas mudanças altera o comportamento observável do pipeline (mesmas rotas, mesmo formato de entrada/saída, mesmas regras de negócio) — é uma troca de "onde e como" a infraestrutura roda, não do "o quê".

## Arquitetura

```
Internet
  → nginx (host, porta 443, TLS via certbot)
      → proxy_pass → container "app" (porta interna 3000)

container "app" (imagem Docker construída deste repo)
  ├── Next.js (next start) — mesmas rotas de hoje:
  │     /api/webhook, /api/telegram-poll, /api/story-image,
  │     /api/tiktok-image-proxy, /api/tiktok-oauth-callback
  ├── Chromium + Playwright — instalados na build da imagem (Dockerfile),
  │     não mais por chamada
  └── generate-link.playwright.mjs — rodado via child_process.execFile
        a partir de affiliateLink.ts, no mesmo filesystem do container
        (sem Sandbox remota)

volume Docker "./data:/data" (persistente no disco do VPS)
  ├── ml-session.json          (era ML_SESSION_BLOB_URL)
  ├── telegram-session.txt     (era TELEGRAM_SESSION_BLOB_URL)
  ├── telegram-cursor.json     (era cursorStore.ts → Blob)
  ├── tiktok-tokens.json       (era tiktokTokenStore.ts → Blob)
  └── telegram-poll.lock       (era lock.ts → Blob)

crontab do host (substitui cron-job.org)
  */15 * * * *  curl -sf -H "Authorization: Bearer $CRON_SECRET" \
                  https://<dominio>/api/telegram-poll

cron diário do host (backup)
  0 3 * * *  tar czf /opt/promopost/backups/$(date +\%F).tar.gz /opt/promopost/data
```

## Componentes

| Componente | Responsabilidade | Substitui |
|---|---|---|
| **Dockerfile** (novo) | Imagem `node:24-slim` + deps de sistema do Chromium (mesma lista hoje instalada via `dnf` no `onCreate` da Sandbox, adaptada pra `apt`) + `npx playwright install --with-deps chromium`, instalados **uma vez na build**, não por execução. `npm ci && npm run build`, `CMD next start`. | `getSandbox()`/`onCreate` em `affiliateLink.ts` |
| **docker-compose.yml** (novo) | Sobe o serviço `app`, monta `./data:/data`, carrega `.env`, expõe porta interna 3000. | — |
| **`src/lib/storage/localStore.ts`** (novo) | Funções genéricas `readJson`/`writeJson`/`readText`/`deleteFile` sobre um diretório fixo (`DATA_DIR`, default `/data`). Única peça que sabe que o backend é filesystem. | `@vercel/blob` (`head`/`put`/`del`) |
| **`src/lib/social/tiktokTokenStore.ts`** (modificado) | `loadTikTokTokens`/`saveTikTokTokens` passam a chamar `localStore` em vez de `head`/`put` do Blob. Mesma assinatura, mesmos chamadores (`tiktok.ts`, rota de callback OAuth) sem mudança. | `@vercel/blob` |
| **`src/lib/telegram/cursorStore.ts`** (modificado) | Idem, `loadCursor`/`saveCursor`. | `@vercel/blob` |
| **`src/lib/telegram/lock.ts`** (modificado) | `acquireLock`/`releaseLock` idem, usando mtime do arquivo em vez de `uploadedAt` do Blob pra checar idade do lock. | `@vercel/blob` |
| **`src/lib/telegram/sessionStore.ts`** (modificado) | `loadSession()` lê `telegram-session.txt` de `DATA_DIR` em vez de fazer `fetch` numa URL do Blob. | `TELEGRAM_SESSION_BLOB_URL` |
| **`src/lib/session/sessionStore.ts`** (modificado) | `loadSession()` (Mercado Livre) lê `ml-session.json` de `DATA_DIR`. | `ML_SESSION_BLOB_URL` |
| **`src/lib/mercadolivre/affiliateLink.ts`** (modificado) | `getSandbox()`/`sandbox.writeFiles()`/`sandbox.runCommand()` viram um único `execFile('node', [SCRIPT_PATH, productLink], { env })` local — sem criar Sandbox, sem `npm install`/`dnf install` por chamada. Script lê a sessão direto de `DATA_DIR` (via env var `ML_SESSION_PATH`) em vez de receber o buffer por `writeFiles`. | `@vercel/sandbox` |
| **`scripts/bootstrap-session.mjs`, `scripts/bootstrap-telegram-session.mjs`** (modificados) | Continuam rodando localmente (máquina do usuário, browser visível) pra login manual, mas gravam o resultado num arquivo local em vez de subir pro Blob — o arquivo é então copiado pro VPS via `scp` como parte do runbook de setup. | `@vercel/blob` (`put`) |
| **nginx + certbot** (host, fora do container) | Reverse proxy HTTPS pro container, renovação automática de certificado. | Rede/TLS gerenciados pela Vercel |
| **crontab do host** (2 entradas) | Chama `/api/telegram-poll` a cada 15min; roda backup diário do diretório de dados. | Vercel Cron / cron-job.org |
| **`deploy.sh`** (novo, no VPS) | `git pull && docker compose up -d --build` — mesmo espírito manual do `vercel deploy --prod` de hoje. | Deploy automático da Vercel |

## Fluxo de dado

Idêntico ao pipeline já documentado nos specs anteriores (`POST /api/webhook` → `fetchProductAndAffiliateLink` → `buildPostText` → `publishArticle` (Shopify) → `postToSocialNetworks`), e `GET /api/telegram-poll` → `pollTelegram` → chama `POST /api/webhook` internamente. **Nenhuma mudança no formato de entrada/saída de nenhuma rota.** A única diferença observável de fora é a URL base (domínio do VPS em vez de `promopost.vercel.app`) e a latência do primeiro scraping depois de um deploy (Chromium já vem pronto na imagem, não precisa mais "esquentar" uma Sandbox nova).

## Tratamento de erro

- **Mesmos códigos de erro do script Playwright** (`SESSION_EXPIRED`, `PRODUCT_NOT_FOUND`, `MARKETPLACE_NOT_SUPPORTED`, `PRODUCT_LIST_LINK`, `SHOPEE_CREDENTIALS_MISSING`, `SHOPEE_API_ERROR`) — `affiliateLink.ts` continua parseando o mesmo `stdout`/`stderr`/`exitCode`, só que de um `execFile` local em vez de `sandbox.runCommand()`. Os `throw` correspondentes em `affiliateLink.ts` não mudam.
- **Falha ao ler arquivo local ausente** (`ENOENT`) nos módulos de storage é tratada como "não existe ainda" (retorna `null`, mesmo comportamento do `head()` falhando hoje) — não é erro fatal pra cursor/tokens/lock, que têm estado inicial vazio legítimo.
- **Sessão Mercado Livre/Telegram ausente** continua sendo erro fatal explícito (`ML_SESSION_BLOB_URL não configurada` vira algo como `Arquivo de sessão do Mercado Livre não encontrado em /data/ml-session.json` — mesma severidade, mensagem adaptada).
- **Container reiniciando/OOM**: Docker com `restart: unless-stopped` no compose garante que a aplicação volta sozinha; um poll perdido nesse intervalo é aceitável (mesma filosofia "sem retry automático" já usada no resto do projeto) e o próximo ciclo de 15min recupera o cursor de onde parou.

## Testagem

- **Módulos de storage local**: testes unitários dos 5 arquivos modificados, trocando os mocks de `@vercel/blob` pelos equivalentes de `node:fs` (mesmo padrão dos testes já existentes, só troca o que é mockado) — cobre leitura ausente, leitura com dado, escrita, e (pro lock) expiração por idade do arquivo.
- **`affiliateLink.ts`**: testes unitários trocando o mock de `Sandbox.getOrCreate`/`runCommand`/`writeFiles` por mock de `child_process.execFile`, mantendo os mesmos casos de erro já cobertos hoje (ver `affiliateLink.test.ts` atual).
- **Dockerfile/imagem**: build local (`docker build`) validando que a imagem sobe e o Chromium funciona (`npx playwright --version` dentro do container, mais um teste manual de scraping real).
- **Ponta a ponta no VPS**: antes do cutover, testar manualmente cada rota (`/api/webhook` com um link real, `/api/telegram-poll` disparado à mão, `/api/story-image` e `/api/tiktok-image-proxy` acessados publicamente) confirmando que o resultado bate com o que já rodava na Vercel.

## Riscos conhecidos

- **Sessão do Mercado Livre precisa de novo login manual.** Como o plano não migra o conteúdo do Blob (aplicação já parada, ver "Fora do escopo"), a sessão logada do painel de afiliados do Mercado Livre precisa ser recriada rodando `bootstrap-session.mjs` de novo. **Alternativa, se o usuário preferir evitar o novo login:** o Blob ainda deve estar acessível (a suspensão foi só por excesso de operações, o downgrade de plano não necessariamente apaga o conteúdo) — dá pra baixar o `ml-session.json` atual via `vercel blob` antes de desligar tudo, e copiar direto pro VPS. Vale confirmar isso no momento do runbook, não decidir agora.
- **Domínio do VPS muda o `TIKTOK_REDIRECT_URI`.** Precisa reconfigurar no TikTok Developer Portal antes de reautorizar (mesmo passo manual já feito quando o Sandbox de credenciais mudou).
- **Recursos do KVM1 (1 vCPU/4GB) rodando Next.js + Chromium headless simultaneamente.** É a config mais enxuta cogitada — deve caber (Chromium headless usa ~300-500MB por execução, execuções são curtas e não concorrentes no volume atual), mas é o primeiro ponto a investigar se a aplicação ficar lenta ou o container reiniciar por OOM depois do cutover.
- **Sem redundância de storage.** Diferente do Blob (multi-region), o disco do VPS é um único ponto de falha. Mitigado pelo backup diário (`tar` local) e pelo fato de que sessões são regeneráveis via bootstrap — mas um backup só local (mesmo disco) não sobrevive a uma falha de disco inteira. Aceito como risco de baixo impacto dado o tamanho dos dados (poucos KB, fácil recriar).
- **Firewall/hardening básico do VPS não é o foco deste documento** — o runbook cobre o mínimo (ufw com só 22/80/443 abertos, chave SSH em vez de senha), não uma auditoria de segurança completa.

## Próximos passos (fora deste documento)

Depois da migração: configurar credenciais reais da Shopee (`SHOPEE_APP_ID`/`SHOPEE_SECRET_KEY`, já pendente antes desta migração), TikTok em Produção real (vídeo demo + app review, também já pendente), e o restante do roadmap original do MVP (WhatsApp, Amazon, geração de texto via LLM, fila assíncrona) — nenhum desses é abordado aqui.
