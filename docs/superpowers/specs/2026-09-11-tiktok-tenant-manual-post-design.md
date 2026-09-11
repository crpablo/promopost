# Design: Publicação manual no TikTok por tenant (habilita a demo de resubmissão)

**Data:** 2026-09-11
**Contexto:** peça complementar à conexão TikTok por tenant (`docs/superpowers/specs/2026-09-11-tiktok-tenant-connection-design.md`, já em produção). A TikTok exige, pra revisão de app, um vídeo mostrando o fluxo completo de ponta a ponta — Login Kit **e** Content Posting API — através da interface real do produto, não de uma ferramenta interna de admin (guidelines: "showcase the website or app where the features will actually be integrated", "display actual user interface and user interactions"). Hoje uma empresa consegue conectar a própria conta (Peça 2), mas nada deixa ela publicar de fato através dessa conta pela interface do produto — a única forma de publicar continua sendo o `/admin` interno, construído especificamente pra gravar a demo anterior (rejeitada por parecer ferramenta de uso interno). Esta spec cobre o mínimo pra fechar esse gap: deixar o tenant publicar manualmente uma vez conectado, através do próprio `/dashboard`.

**Fora de escopo desta spec:**
- Pipeline automático de origem de promoção por tenant (Peça 3 do pivot maior) — aqui a publicação é sempre manual (o usuário digita/cola os dados), não puxada de um Telegram ou de outra fonte.
- Múltiplas imagens ou vídeo — só foto única (`PULL_FROM_URL`, `media_type: 'PHOTO'`), mesmo modelo já usado hoje.
- Upload de arquivo de imagem — o campo é uma URL colada (com preview), não um upload real. TikTok exige uma URL publicamente alcançável de qualquer forma (`PULL_FROM_URL`), então upload real exigiria hospedar o arquivo em algum lugar primeiro — escopo maior do que o necessário aqui.
- Botão de desconectar TikTok — já decidido fora de escopo na Peça 2, não muda aqui.
- Histórico de posts, edição/exclusão de post já publicado — TikTok não oferece exclusão via API de qualquer forma; fora de escopo.

## Objetivo

Dar a qualquer empresa com TikTok conectado uma forma de publicar uma foto de verdade através da própria interface do produto (`/dashboard`), reaproveitando a lógica de publicação já validada em produção, mas com o token de acesso da própria empresa em vez do token interno da Tobie Store.

## Nota operacional: conta TikTok precisa estar privada

O app do PromoPost ainda não passou pela auditoria de conteúdo da TikTok — enquanto isso, toda publicação é forçada a `privacy_level: SELF_ONLY`, e a API só aceita publicar em contas com a opção "Conta privada" ativada nas configurações da própria TikTok (mesma exigência que já vale hoje pro fluxo interno da Tobie Store). O formulário deve deixar isso explícito antes do usuário tentar publicar, não só depois de um erro.

## Arquitetura

**Refatoração em `src/lib/social/tiktok.ts`:** a assinatura de `postToTikTok` muda de

```typescript
export async function postToTikTok(imageUrl: string, title: string, description: string): Promise<SocialPostResult>
```

para

```typescript
export async function postToTikTok(accessToken: string, imageUrl: string, title: string, description: string): Promise<SocialPostResult>
```

`postToTikTok` deixa de chamar `getValidAccessToken()` internamente — essa função continua existindo e exportada (renomeações não são necessárias), mas quem chama `postToTikTok` agora é responsável por obter o token antes. Isso não muda nenhum comportamento observável dos fluxos internos: os três chamadores atuais passam a chamar `getValidAccessToken()` eles mesmos e repassar o resultado como primeiro argumento — `src/app/api/webhook/route.ts` (duas ocorrências, pipeline automático) e `src/app/api/admin/tiktok-post/route.ts` (uma ocorrência, ferramenta interna de teste manual).

**`src/lib/social/tiktokTenantAuth.ts` (novo):** espelha a lógica de `getValidAccessToken()`/`refreshAccessToken()` já existente em `tiktok.ts`, mas por tenant:

```typescript
export async function getValidAccessTokenForBusiness(pool: Pool, businessId: string): Promise<string>
```

Carrega a conta via `getTikTokAccountForBusiness(pool, businessId)` (Peça 2, já existe). Se não houver conta conectada, lança erro claro ("Conta do TikTok não conectada"). Se `expiresAt` estiver a menos de 5 minutos de vencer (mesma margem de segurança já usada em `tiktok.ts`), renova via `exchangeTikTokToken({ grant_type: 'refresh_token', refresh_token: account.refreshToken })` (já existe, reaproveitado sem mudança) e persiste o resultado via `saveTikTokAccountForBusiness` (Peça 2, já existe, upsert).

**`POST /api/tiktok/post` (novo):** autenticado (`auth()`, mesmo padrão das outras rotas do tenant). Lê `imageUrl`, `title`, `description` do corpo JSON. Busca a `business` da sessão, chama `getValidAccessTokenForBusiness`, monta a URL do proxy de imagem (`${process.env.WEBHOOK_BASE_URL}/api/tiktok-image-proxy?imageUrl=<encoded>` — mesmo padrão já usado em `src/app/api/admin/tiktok-post/route.ts` e no pipeline do webhook, reaproveita a env var já configurada) e chama `postToTikTok(accessToken, proxiedImageUrl, title, description)`. Retorna `{ ok: true, postId }` ou `{ ok: false, error }`, mesmo formato de resposta do `/api/admin/tiktok-post` já existente.

## Interface

No `/dashboard`, quando `tiktokAccount` existir, um formulário novo aparece abaixo do "TikTok conectado ✅" — um client component (`src/app/(app)/dashboard/TikTokPostForm.tsx`, note o nome idêntico ao de `src/app/admin/TikTokPostForm.tsx` mas em pasta diferente — são componentes independentes, não compartilham código):

- Nota fixa acima do formulário avisando sobre a exigência de conta privada (ver seção anterior).
- Campo **Título** (texto).
- Campo **Descrição** (textarea).
- Campo **URL da imagem** (texto) com uma **preview ao vivo**: uma tag `<img>` abaixo do campo, `src` atualizado a cada mudança (debounce não é necessário — o navegador já lida bem com isso), escondida/com placeholder enquanto o campo estiver vazio.
- Botão "Publicar no TikTok", desabilitado com texto "Publicando..." durante o envio.
- Mensagem de resultado abaixo do botão: sucesso (verde, menciona que foi publicado) ou erro (vermelho, mensagem literal vinda da API — mesmo padrão do `/admin` existente, mas com o mesmo estilo/paleta do resto do `/dashboard`, não solto num card separado).

Sem token de admin na URL, sem paleta cinza de painel interno — os mesmos `inline styles` (`display:flex, flexDirection:'column', gap`) já usados em `/login` e `/onboarding`, only com labels acima dos campos (não ao lado) pra parecer mais formulário de produto do que formulário de admin.

## Tratamento de erro

- Sem TikTok conectado (usuário chega na rota sem `tiktok_accounts`): a rota retorna erro claro, mas isso não deveria ser alcançável pela UI (o formulário só aparece quando `tiktokAccount` existe) — defesa em profundidade, não fluxo esperado.
- Renovação de token falhar (refresh token também expirado/revogado): mensagem "Sua conexão com o TikTok expirou, reconecte antes de publicar" — o formulário deve deixar claro que o usuário precisa clicar em "Reconectar" (link já existente no `/dashboard`) antes de tentar de novo.
- Falha na publicação em si (privacidade da conta, imagem inválida/não encontrada, TikTok fora do ar): mostra a mensagem de erro literal retornada pela API da TikTok, sem stack trace — mesmo padrão do `/admin` (`postToTikTok` já formata essas mensagens).

## Testes

- `src/lib/social/tiktok.test.ts` (existente): atualiza os testes pra passar `accessToken` como primeiro argumento em vez de mockar `loadTikTokTokens`/`getValidAccessToken` internamente.
- `src/lib/social/tiktokTenantAuth.test.ts` (novo): testa o caso "token ainda válido, não renova", "token perto de vencer, renova e persiste", "sem conta conectada, lança erro claro" — mock do `Pool` e do `fetch` (reaproveita o padrão de `vi.hoisted`/`vi.mock` já usado em `sendMagicLink.test.ts` e nos testes das rotas do TikTok).
- `src/app/api/tiktok/post/route.test.ts` (novo): mesmo padrão das outras rotas — mocka `auth`, `getValidAccessTokenForBusiness`, `postToTikTok`, cobre sucesso, sem sessão, sem business, falha na renovação, falha na publicação.
- `src/app/api/webhook/route.test.ts` e `src/app/api/admin/tiktok-post/route.test.ts` (existentes): precisam continuar passando depois da mudança de assinatura de `postToTikTok` — os mocks existentes desses arquivos precisam passar a fornecer/mockar o `accessToken` como primeiro argumento esperado.
- `TikTokPostForm.tsx` (novo, no dashboard): sem teste automatizado — mesma exceção já usada pra toda página/formulário deste projeto (nenhum precedente de teste de componente React aqui, incluindo o `TikTokPostForm.tsx` do `/admin`). Verificação manual: publicar de verdade com uma conta de teste conectada e conferir que o post aparece na conta TikTok.
