# Design: página admin para disparo manual de post no TikTok

**Data:** 2026-08-27
**Contexto:** [[promopost-tiktok-setup-pending]] — para submeter o app do TikTok à revisão de Produção, o TikTok exige um vídeo demo mostrando o fluxo de login (Login Kit) + um post real passando pela Content Posting API. O PromoPost não tem nenhuma UI de usuário (é 100% automação disparada por webhook do Mercado Livre), então não existe hoje uma jornada clicável para gravar. Este design cobre uma ferramenta interna mínima para preencher essa lacuna.

## Objetivo

Permitir disparar `postToTikTok()` manualmente, via uma página simples, sem depender de um webhook real do Mercado Livre chegar. Serve tanto para gravar o vídeo de review quanto como ferramenta de teste manual futura (ex.: verificar se a integração ainda funciona sem esperar uma promoção real passar pelo pipeline).

## Arquitetura

Duas peças novas, seguindo os padrões já usados no projeto (rotas de API simples, sem framework de admin/dashboard):

1. **`src/app/admin/page.tsx`** — server component.
   - Lê `token` da query string (`?token=...`).
   - Compara com `process.env.ADMIN_TOKEN`. Se não bater (ou a env var não estiver configurada), renderiza uma página genérica de "não encontrado" — não revela que a ferramenta existe.
   - Se bater, renderiza um client component com formulário: campo de URL da imagem (pré-preenchido com um exemplo real de produto em `mlstatic.com`), campo de título, campo de descrição, e um botão "Publicar no TikTok".

2. **`POST /api/admin/tiktok-post/route.ts`** — recebe `{ imageUrl, title, description, token }` no corpo.
   - Valida `token` de novo no backend (o front nunca é a única barreira — mesmo princípio já usado em `/api/webhook`, que valida `WEBHOOK_SECRET` no handler, não só no client).
   - Monta a URL proxied da imagem: `${process.env.WEBHOOK_BASE_URL}/api/tiktok-image-proxy?imageUrl=<imageUrl>` — mesmo padrão que `buildTikTokImageProxyUrl()` já usa em `src/app/api/webhook/route.ts`, necessário porque a TikTok só aceita `pull_by_url` vindo de um domínio verificado como nosso (não o domínio de terceiro onde a imagem original mora).
   - Chama `postToTikTok(proxiedImageUrl, title, description)` de `src/lib/social/tiktok.ts` (função já existe e é reaproveitada sem alteração).
   - Retorna JSON `{ ok: true, postId }` ou `{ ok: false, error }`.

## Fluxo de dados

```
usuário → GET /admin?token=X → formulário (se token bate)
       → preenche/edita campos → submit
       → POST /api/admin/tiktok-post { imageUrl, title, description, token }
       → valida token → monta proxiedImageUrl → postToTikTok()
       → resposta { ok, postId | error } renderizada na própria página
```

## Auth

Nova env var `ADMIN_TOKEN` (mesmo padrão de `WEBHOOK_SECRET`: string simples comparada por igualdade, sem sistema de sessão/login). Documentar no `docs/runbook.md` junto da seção 11 (TikTok).

## Tratamento de erro

- Token ausente/errado: página/rota tratam como "não encontrado" (não vazam detalhes de auth).
- Erro do `postToTikTok()` (ex.: imagem rejeitada, token TikTok expirado): mensagem crua da exceção é exibida na página — decisão deliberada, é uma ferramenta interna de debug/demo, não uma UI pública, então não faz sentido esconder o erro real de quem está gravando o vídeo.

## Fora de escopo

- Não mexe no pipeline de produção (`/api/webhook`) nem no `postToTikTok()`.
- Não adiciona autenticação de verdade (login, sessão, múltiplos usuários) — é uma porta lateral protegida por token, mesmo nível de proteção que o webhook já tem.
- Não cobre os outros itens pendentes do checklist de Produção (texto de explicação de escopos, submissão do review em si) — só a peça de "ter algo pra gravar".

## Vida útil

Permanente — fica no código como ferramenta de teste manual, protegida pelo token. Sem custo de manutenção relevante.
