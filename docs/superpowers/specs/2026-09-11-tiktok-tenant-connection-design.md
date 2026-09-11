# Design: Conexão de conta TikTok por tenant (Peça 2)

**Data:** 2026-09-11
**Contexto:** peça 2 do pivot multi-tenant descrito em `docs/superpowers/specs/2026-09-03-multitenant-foundation-design.md` — a fundação (cadastro/login de empresas via Auth.js + Postgres, `/login` → `/onboarding` → `/dashboard`) já está em produção. Esta spec cobre a próxima peça: cada empresa cadastrada poder conectar sua própria conta do TikTok pelo próprio `/dashboard`, em vez do PromoPost continuar amarrado a uma única conta interna (Tobie Store).

**Fora de escopo desta spec** (permanece como está, ou vira peça futura própria):
- O pipeline automático de postagem (`webhook/route.ts` → `postToTikTok()`) continua rodando só para a Tobie Store, usando o token interno existente (`tiktokTokenStore.ts` / `tiktok-tokens.json`). Esta peça **não** pluga a conta recém-conectada de um tenant nesse pipeline — isso é a Peça 3 (origem de promoção por tenant), que também precisa resolver de onde vem a promoção de cada empresa antes de fazer sentido postar algo.
- A rota interna `/api/tiktok-oauth-callback` e o arquivo `tiktok-tokens.json` não são modificados.
- Desconectar uma conta TikTok já conectada (ver "Decisão: sem botão de desconectar" abaixo).
- Mostrar informações da conta conectada (nome de usuário, avatar) além de "conectado" — a API da TikTok exigiria escopo/chamada adicional só para isso; fica pra quando (se) fizer falta.

## Objetivo

Dar a cada empresa logada a capacidade de autorizar sua própria conta do TikTok via OAuth, com o token guardado isolado por `business_id`, sem tocar no fluxo interno da Tobie Store que já funciona em produção.

## Nota operacional: Sandbox ainda restringe quem pode autorizar

O app do PromoPost na TikTok continua em Sandbox (a submissão de Produção de 2026-08-27 foi rejeitada — ver `docs/superpowers/specs/2026-09-03-multitenant-foundation-design.md`). Nesse modo, a TikTok só permite autorizar contas cadastradas manualmente como "Target Users" no Developer Portal. Ou seja: para testar este fluxo de ponta a ponta com uma segunda empresa/conta, é preciso primeiro adicionar essa conta como target user lá — não tem como automatizar esse passo, e ele não faz parte desta implementação.

## Arquitetura

Duas rotas novas, isoladas do fluxo interno existente:

- **`GET /api/tiktok/connect`** — autenticado (`auth()` de `@/auth`, mesmo padrão do `(app)/layout.tsx`; sem sessão, redireciona `/login`). Gera um `state` aleatório (CSRF), grava em cookie `httpOnly` de curta duração (~10min) e redireciona (302) para a URL de autorização da TikTok com `client_key`, `scope`, o novo `redirect_uri` e o `state`.

Reaproveita as mesmas credenciais já configuradas (`TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET`) — é o mesmo app TikTok (Sandbox), só um "Redirect URI" adicional cadastrado no Developer Portal. Precisa de uma env var nova, `TIKTOK_TENANT_REDIRECT_URI`, separada de `TIKTOK_REDIRECT_URI` (que continua apontando para a rota interna) — as duas rotas de callback não podem compartilhar a mesma URI de redirect.
- **`GET /api/tiktok/callback`** — autenticado (mesma checagem). Confere `state` da query contra o cookie; ausente/expirado/divergente é tratado como erro. Se a TikTok mandou `?error=`, mesma coisa. Troca `code` por tokens reaproveitando `exchangeTikTokToken()` de `src/lib/social/tiktokTokenStore.ts` (função já agnóstica de onde persiste o resultado). Busca a `business` do usuário atual (`getBusinessForUser`) e grava o token via a nova `saveTikTokAccountForBusiness()`.

O fluxo interno atual não valida `state` — não é alterado por esta spec, mas a ausência dessa proteção lá é aceitável porque aquela rota é operada só por quem tem acesso ao servidor. A rota nova fica exposta a qualquer usuário logado, então `state` é obrigatório aqui.

**Decisão: sem botão de desconectar.** Reconectar (clicar em "Conectar TikTok" de novo) sobrescreve o token via upsert — cobre o caso real de trocar de conta, sem precisar de uma ação de "desconectar" separada nesta fase.

## Modelo de dados

Nova migration `db/migrations/002_tiktok_accounts.sql`, incremental sobre o schema da fundação:

```sql
create table if not exists tiktok_accounts (
  business_id    bigint not null unique references businesses(id) on delete cascade,
  access_token   text not null,
  refresh_token  text not null,
  expires_at     timestamptz not null,
  connected_at   timestamptz not null default now()
);
```

`business_id unique` — mesmo padrão de `businesses.owner_user_id`: garante "1 empresa, 1 conta TikTok" via constraint de banco. Reconectar faz `insert ... on conflict (business_id) do update`.

`src/lib/db/tiktokAccounts.ts` (mesmo padrão de `src/lib/db/businesses.ts`, `Pool` do `pg` injetado):
- `getTikTokAccountForBusiness(pool, businessId): Promise<TikTokAccount | null>`
- `saveTikTokAccountForBusiness(pool, businessId, tokens): Promise<TikTokAccount>` (upsert)

## Fluxo

1. `/dashboard` passa a consultar `tiktok_accounts` pelo `business_id` da empresa logada.
   - **Sem conta conectada:** mostra o botão "Conectar TikTok" (hoje um placeholder desabilitado) como link real para `/api/tiktok/connect`.
   - **Com conta conectada:** mostra "TikTok conectado ✅" e um link "Reconectar" apontando para o mesmo `/api/tiktok/connect`.
2. `GET /api/tiktok/connect` — sem sessão, `/login`. Gera `state`, grava cookie, redireciona para a TikTok.
3. Usuário autoriza (ou nega) na TikTok.
4. `GET /api/tiktok/callback` — sem sessão, `/login`. `?error=` presente → `/dashboard?tiktok_error=1`. `state` inválido/ausente → mesmo destino. Troca `code` por tokens, busca a `business` atual, faz upsert em `tiktok_accounts`, redireciona para `/dashboard` (agora mostrando "conectado").

## Tratamento de erro

Todo caminho de falha (autorização negada, `state` inválido, troca de código malsucedida, banco indisponível) cai no mesmo padrão simples: redireciona para `/dashboard?tiktok_error=1`, que renderiza uma mensagem genérica amigável — sem stack trace exposto, mesmo espírito do `/login?error=1` já existente na fundação.

## Testes

- `tiktokAccounts.ts` — testável puro com Vitest, mock do `Pool`, mesmo padrão de `businesses.test.ts`.
- `/api/tiktok/connect` — testa redirect (302) para a URL da TikTok com os parâmetros certos e o cookie de `state` setado; sem sessão, redireciona para `/login`.
- `/api/tiktok/callback` — mesmo padrão do teste já existente para a rota interna (`tiktok-oauth-callback/route.test.ts`): mocka `fetch` e o módulo de acesso a dados, cobre sucesso, `state` inválido/ausente, `error` vindo da TikTok, falha na troca de token, sem sessão.
- `/dashboard` — sem teste automatizado (mesma exceção já usada para páginas na fundação), verificação manual no navegador antes de considerar a task pronta.
