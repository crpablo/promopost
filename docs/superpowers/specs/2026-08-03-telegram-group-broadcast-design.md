# PromoPost — Disparo de promoções pra grupos do Telegram

## Contexto e motivação

Hoje o Telegram só entra no pipeline do PromoPost como **origem**: um canal (`TELEGRAM_TARGET_CHAT_ID`) é monitorado pelo poller, que extrai promoções e dispara o webhook. O lado de saída (`postToSocialNetworks`, dentro de `/api/webhook`) publica em Facebook, Instagram (feed + Stories) e TikTok, mas nunca de volta pro Telegram.

Este documento cobre adicionar o Telegram também como **destino**: além do canal de origem, disparar cada promoção processada pra uma lista de grupos do Telegram, reaproveitando a mesma sessão GramJS (`teleproto`) já autenticada e usada hoje pelo poller pra ler o canal.

**WhatsApp foi descartado como destino nesta rodada** (decisão tomada antes deste brainstorm): a API oficial do WhatsApp Business não suporta postar em grupo — só conversa 1:1 e mensagens de template — e a única forma de automatizar isso seria uma biblioteca não-oficial simulando uma sessão do WhatsApp Web, o que viola os termos de uso e arrisca banir o número de verdade. Fica de fora até aparecer um caminho oficial, ou o usuário decidir assumir esse risco conscientemente.

## Escopo deste documento

**Dentro do escopo:**
- Enviar cada promoção publicada (as mesmas que já viram post no Facebook/Instagram/TikTok) também como mensagem de foto + legenda pra uma lista configurável de grupos do Telegram.
- Reaproveitar a legenda já usada nas outras redes (`buildSocialCaption`) — mesmo texto, sem variação por canal.
- Reaproveitar a sessão GramJS já autenticada (mesma conta, sem credencial nova, sem app review).
- Lista de grupos configurável via variável de ambiente (`TELEGRAM_TARGET_GROUP_IDS`), mesmo padrão de configuração já usado no projeto inteiro.

**Fora do escopo (decisões já tomadas neste brainstorm):**
- **WhatsApp como destino.** Ver justificativa acima — não é uma escolha de arquitetura, é uma restrição de plataforma (API oficial não suporta grupo) e um risco real de conta (automação não-oficial pode banir o número).
- **Gestão da lista de grupos por interface/rota própria.** A lista fica só em variável de ambiente — pra adicionar ou remover um grupo, edita `.env` na VPS e reinicia o container (mesmo processo já usado pra `AMAZON_ASSOCIATE_TAG`, `SHOPEE_APP_ID`, etc., sem rebuild). Uma interface de gestão fica pra se a lista crescer a ponto de valer a pena — não há evidência disso ainda.
- **Legenda específica pro Telegram.** Reaproveita a mesma `buildSocialCaption()` usada em Facebook/Instagram/TikTok, sem uma variação de texto/formatação própria pro Telegram (ex: link clicável via Markdown). Se o formato atual (link como texto puro) se mostrar ruim na prática, revisitar depois.
- **Fila, delay artificial ou proteção contra limite de envio do Telegram.** Não há evidência ainda de que a conta vá esbarrar em limite de disparo simultâneo mandando pra uma lista pequena de grupos — mesmo raciocínio já usado antes no projeto (ex: o rate limit da Meta só foi endereçado depois de acontecer de verdade, não preventivamente).

## Por que este approach (arquitetura)

O webhook (`/api/webhook`) já monta `product`, `affiliateLink` e a legenda social dentro de `postToSocialNetworks()`, e dispara Facebook, Instagram (feed + Story) e TikTok em paralelo, cada um best-effort — falha de um canal não derruba os outros. A adição natural é um **quinto branch** nesse mesmo `Promise.all`: `postToTelegramGroups(imageUrl, caption)`.

Diferente dos outros canais (que têm um único destino por chamada), o Telegram tem **múltiplos destinos** (uma lista de grupos) numa única chamada — por isso a função abre a conexão GramJS **uma única vez** (reaproveitando a mesma sessão salva em `/data/telegram-session.txt`, já lida pelo poller hoje) e envia a mensagem pra cada grupo da lista em sequência, usando a mesma conexão, antes de desconectar.

A sessão já é usada em paralelo pelo poller (a cada 15 minutos, via cron) sem conflito: contas do Telegram suportam múltiplas conexões simultâneas da mesma sessão (o mesmo princípio de usar Telegram no celular e no desktop ao mesmo tempo) — não é necessário nenhum lock entre o poller e esse novo envio, diferente do lock que already existe entre execuções concorrentes do próprio poller.

## Arquitetura

```
POST /api/webhook { link, coupon?, discountedPrice? }
  → runPipeline(...) → { product, affiliateLink, postUrl }
  → postToSocialNetworks(product, affiliateLink, coupon, discountedPrice):
      → buildSocialCaption(...) — já existente, reaproveitado sem mudança
      → Promise.all([
          postToFacebook(...),         — já existente
          postToInstagram(...),        — já existente
          postStoryToInstagram(...),   — já existente
          postToTikTok(...),           — já existente
          postToTelegramGroups(...)    — NOVO
        ])
  → retorna { postUrl, facebook, instagram, story, tiktok, telegram }
```

`postToTelegramGroups(imageUrl, caption)`:
1. Lê `TELEGRAM_TARGET_GROUP_IDS` do ambiente (lista separada por vírgula). Se vazio/ausente, retorna `{ok: false, results: []}` sem tentar conectar — mesmo espírito do `NAO_CONFIGURADO` já usado pros outros canais, adaptado ao formato de múltiplos resultados deste canal.
2. Lê a sessão salva (`loadSession()`, já existente em `src/lib/telegram/sessionStore.ts`) e abre **uma** conexão GramJS.
3. Pra cada grupo da lista, tenta enviar a imagem do produto (`imageUrl`) como foto com `caption` por baixo — captura erro por grupo individualmente, sem interromper os demais.
4. Desconecta a conexão.
5. Retorna `{ok: boolean, results: [{groupId, ok, error?}]}` — `ok` geral é `true` só se pelo menos um grupo recebeu com sucesso (mesmo espírito best-effort dos outros canais: sucesso parcial ainda é reportado como parcialmente ok, não como falha total).

## Componentes

| Componente | Responsabilidade | Depende de |
|---|---|---|
| **`postToTelegramGroups()`** (novo, `src/lib/social/telegramGroups.ts`) | Abre a sessão GramJS, envia foto+legenda pra cada grupo configurado, agrega resultado por grupo. Recebe as dependências (fábrica de cliente / função de envio) injetadas, mesmo padrão de `PollerDeps` — testável com mocks. | `teleproto` (já usado), `sessionStore.ts` (já existente) |
| **Webhook / `postToSocialNetworks`** (`src/app/api/webhook/route.ts`) | Ganha um quinto branch no `Promise.all`, chamando `postToTelegramGroups` com a mesma imagem/legenda já montadas pros outros canais. | `postToTelegramGroups` |
| **Configuração** | Nova env var `TELEGRAM_TARGET_GROUP_IDS` (lista de IDs separados por vírgula), no mesmo `.env` da VPS. | — |

## Fluxo de dado

Idêntico ao pipeline já documentado até `postToSocialNetworks` — a única mudança é esse quinto branch dentro dela, usando os mesmos `product.imageUrl` e `caption` já calculados pros outros canais (nenhuma chamada de rede nova pra buscar dado de produto).

## Tratamento de erro

- **`TELEGRAM_TARGET_GROUP_IDS` não configurado** — retorna `{ok: false, results: []}` sem tentar conectar, mesmo espírito de `NAO_CONFIGURADO` já usado pros outros canais.
- **Sessão do Telegram expirada/inválida** — erro capturado na conexão, reportado como falha geral do canal `telegram` (mesma sessão que o poller usa; se ela expirar, o poller também vai começar a falhar — sintoma já conhecido, não é um modo de falha novo).
- **Grupo específico falha** (bot/conta removida do grupo, ID inválido, grupo não existe mais) — capturado por grupo, não interrompe o envio pros demais grupos da lista. Reportado no array `results`.
- **Limite de envio do Telegram (flood wait)** — não tratado preventivamente (ver Escopo). Se acontecer na prática, aparece como falha naquele grupo específico com a mensagem de erro do Telegram, e revisitamos com dados reais na mão.

## Testagem

- **`postToTelegramGroups()`**: testes unitários com dependências mockadas (cliente/função de envio injetados), cobrindo: lista vazia/ausente (`não configurado`), sucesso em todos os grupos, sucesso parcial (um grupo falha, outros não), todos os grupos falhando. Mesmo padrão já usado em `poller.test.ts` com `PollerDeps` mockado.
- **Webhook**: teste de integração garantindo que o novo campo `telegram` aparece no JSON de resposta, seguindo o padrão dos testes já existentes pra `facebook`/`instagram`/`story`/`tiktok`.
- **Sem teste automatizado pro envio real via GramJS** — mesma limitação já aceita pro resto da integração com Telegram (poller) e pro scraping dos marketplaces. Validação manual com pelo menos 1 grupo de teste real antes de considerar pronto.

## Riscos conhecidos

- **GramJS pode não aceitar URL direta pra enviar foto.** Precisa confirmar na implementação se `sendFile` aceita a URL da imagem do produto diretamente ou se é necessário baixar a imagem primeiro e enviar como Buffer — só descobre testando contra o Telegram de verdade. Não muda a arquitetura, só pode adicionar um passo de download dentro de `postToTelegramGroups()`.
- **Limite de envio simultâneo (flood wait) da conta do Telegram**, ver Tratamento de erro — aceito como risco não endereçado preventivamente.
- **Falta de UI de gestão da lista de grupos** significa que adicionar/remover grupo sempre exige acesso SSH à VPS — aceito por ora (ver Escopo), revisitar se a lista crescer bastante ou se o usuário quiser dar esse controle pra outra pessoa sem acesso à VPS.

## Próximos passos (fora deste documento)

Depois desta integração, o roadmap ainda lista: gatilho via WhatsApp (descartado como destino aqui, mas pode voltar como *origem* — grupo de WhatsApp que dispara promoção pro PromoPost — separado deste documento, que é só sobre saída), geração de texto do post via LLM, e migração pra arquitetura de fila assíncrona.
