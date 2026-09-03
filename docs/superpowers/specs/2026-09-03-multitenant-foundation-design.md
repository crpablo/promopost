# Design: Fundação multi-tenant (cadastro/login de empresas)

**Data:** 2026-09-03
**Contexto:** o app de Produção do PromoPost na TikTok foi rejeitado — "App will not be approved for personal or company internal use" (política oficial: [App Review Guidelines](https://developers.tiktok.com/docs/en/app-review-guidelines) — "Apps must not be for private or personal use"). Ferramentas como Buffer/Hootsuite são aprovadas porque são usadas por muitas empresas diferentes, cada uma conectando sua própria conta; o PromoPost, como existe hoje, é usado só pela Tobie Store. A decisão foi transformar o PromoPost num SaaS de verdade — outras lojas poderão se cadastrar e conectar suas próprias contas. Este documento cobre só a primeira peça desse pivot: a fundação multi-tenant (cadastro/login), dimensionada para suportar a próxima peça (conexão TikTok por tenant) sem precisar de retrabalho.

**Fora de escopo desta spec** (peças futuras, cada uma com seu próprio ciclo spec→plano→implementação):
- Conexão de conta TikTok por tenant (Peça 2)
- Origem de promoção por tenant (hoje acoplada a um único canal do Telegram da Tobie Store) (Peça 3)
- Outras redes sociais por tenant (Facebook/Instagram/Shopify/Telegram broadcast) (Peça 4)
- Billing/planos (Peça 5, se/quando fizer sentido)
- Múltiplos usuários por empresa (time/convites) — decisão explícita de não fazer agora, ver "Modelo de dados"

## Objetivo

Dar ao PromoPost cadastro e login real de empresas (tenants), sem tocar em nada do que já funciona hoje (`/api/webhook`, `/admin`, pipeline automatizado da Tobie Store) — que continuam existindo e rodando exatamente como estão, como a "conta interna" da própria Tobie Store, até serem migrados pra dentro do modelo multi-tenant numa peça futura (fora de escopo aqui).

## Arquitetura

- **Postgres novo**, rodando via Docker na mesma VPS (`46.202.147.12`) — novo serviço no `docker-compose.yml` existente, com seu próprio volume persistente. Primeira vez que o projeto tem um banco de dados de verdade (hoje é tudo arquivo JSON em `/opt/promopost/data`, ver `docs/runbook.md`).
- **Auth.js (NextAuth v5)** com o adapter oficial de Postgres — cuida de sessão, cookies, CSRF e da tabela de usuários/contas/tokens de verificação. Provider único por enquanto: **Email (magic link)**, sem senha.
- **Resend** para o envio do email do magic link — API simples, funciona de qualquer backend (não depende de estar na Vercel), plano grátis cobre o volume esperado no início.
- Área autenticada nova, num route group separado do App Router (ex.: `src/app/(app)/...`), isolada das rotas de automação existentes. Nenhuma rota/arquivo do fluxo atual (`webhook`, `admin`, `tiktok-image-proxy`, etc.) é modificada nesta spec.

## Modelo de dados

Tabelas do Auth.js (schema padrão do adapter — `users`, `accounts`, `sessions`, `verification_tokens`), mais uma tabela nova:

```
businesses
  id            uuid primary key
  owner_user_id uuid not null unique references users(id)
  name          text not null
  created_at    timestamptz not null default now()
```

`owner_user_id` é `unique` — é essa constraint, a nível de banco, que garante "1 usuário = 1 empresa" (decisão explícita: sem conceito de time/múltiplos usuários por empresa por enquanto — mais simples de construir agora, e dá pra evoluir depois sem jogar fora este modelo, só relaxando a constraint e adicionando uma tabela de membership).

## Fluxo

1. Usuário visita `/login`, digita o email.
2. Auth.js gera o token de verificação e dispara o email via Resend, com o magic link.
3. Usuário clica no link → Auth.js valida o token, cria a sessão → redireciona pra `/dashboard`.
4. `/dashboard` (server component) verifica se existe uma `business` com `owner_user_id` = usuário atual.
   - **Não existe:** redireciona pra `/onboarding` — formulário simples com um campo (nome da empresa) → cria a `business` → volta pra `/dashboard`.
   - **Existe:** segue normal.
5. `/dashboard` nesta fase: mostra "Bem-vindo, {nome da empresa}" e um placeholder do que vem a seguir (ex.: botão "Conectar TikTok" desabilitado/"em breve"). Propositalmente mínimo — é a casca que a Peça 2 vai preencher.

## Tratamento de erro

- Magic link expirado/inválido: página de erro padrão do Auth.js, com link pra voltar em `/login` e pedir um novo.
- Falha no envio do email (Resend fora do ar, etc.): erro claro na própria tela de `/login`, sem stack trace exposto.
- Acesso a `/dashboard` ou `/onboarding` sem sessão válida: redireciona pra `/login` (middleware de auth padrão do Auth.js).

## Testes

- A lógica de criar/associar `business` ao usuário (ex.: `getOrCreateBusinessForUser(userId)`) vira uma função pura em `src/lib/`, testável com Vitest — mesmo padrão já usado no projeto (mock do client do Postgres).
- O fluxo de login em si (Auth.js + magic link end-to-end) não compensa automatizar — sem precedente de teste de página/fluxo de auth neste projeto, e o custo de simular emails/tokens de verificação é alto pro benefício. Verificação manual no navegador antes de considerar a task pronta, mesmo padrão já usado na Task 2 do `/admin` (`docs/superpowers/plans/2026-08-27-tiktok-admin-demo.md`).
