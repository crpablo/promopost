# PromoPost MVP — Runbook de validação

Checklist pra validar o fluxo completo depois de implementar todas as tasks do plano.

## 1. Configurar variáveis de ambiente na Vercel

- `WEBHOOK_SECRET` — qualquer string aleatória longa.
- `BLOB_READ_WRITE_TOKEN` — criar um Blob Store no dashboard Vercel (Storage > Blob) e copiar o token.
- `SHOPIFY_SHOP_DOMAIN` — ex: `sua-loja.myshopify.com`.
- `SHOPIFY_ADMIN_ACCESS_TOKEN` — criar um app customizado no admin Shopify com escopo `write_content`.
- `SHOPIFY_BLOG_ID` — GID do blog de destino (`gid://shopify/Blog/<id>`); pegue o `<id>` numérico na URL do blog no admin Shopify.
- `ML_SESSION_BLOB_URL` — preenchido no passo 2 abaixo.

## 2. Bootstrap da sessão Mercado Livre

Rodar localmente (ver Task 9):

```bash
BLOB_READ_WRITE_TOKEN=<token> node scripts/bootstrap-session.mjs
```

Logar manualmente, confirmar, copiar a URL impressa pra `ML_SESSION_BLOB_URL` na Vercel.

## 3. Ajustar os seletores do Playwright contra o site real

Abrir `https://www.mercadolivre.com.br/afiliados/linkbuilder` já logado (mesma sessão do passo 2) e, com o DevTools, confirmar/corrigir os 3 seletores marcados `AJUSTAR` em `src/lib/mercadolivre/generate-link.playwright.mjs` (Task 7):

- placeholder do campo de link,
- texto do botão de gerar link,
- seletor do elemento que mostra o link gerado.

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
- Conferir no painel de afiliados do Mercado Livre que o link gerado (`/sec/...`) corresponde ao produto certo.
- Publicar o artigo manualmente no admin Shopify se o resultado estiver correto.

## 8. Se algo falhar

A resposta de erro do webhook traz `{ "passo": "...", "erro": "..." }` indicando em qual dos 4 passos parou:

- `link_parse` — o link enviado não é reconhecido como produto Mercado Livre.
- `product_fetch` — a API pública do Mercado Livre falhou ou o item não existe.
- `affiliate_link` — a automação Playwright falhou. Se `erro` for `SESSION_EXPIRED`, repita o passo 2 (bootstrap). Caso contrário, a mensagem de erro tenta indicar um caminho de screenshot, mas esse arquivo fica em `/tmp` da execução da função Vercel, que é descartada ao final do request — não é recuperável hoje. Pra debugar, use o texto do erro em si e, se precisar de mais detalhe, rode o script `src/lib/mercadolivre/generate-link.playwright.mjs` localmente contra a sessão salva pra reproduzir a falha com um browser visível.
- `shopify_publish` — a API do Shopify recusou a criação do artigo (token inválido, blog errado, rate limit).
