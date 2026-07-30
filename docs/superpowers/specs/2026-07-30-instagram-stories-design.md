# PromoPost — Postagem em Stories do Instagram

## Contexto e motivação

O sub-projeto de postagem no Instagram e Facebook (spec `2026-07-29-instagram-facebook-posting-design.md`) publica um post de feed com foto + legenda a cada promoção. Este documento cobre a extensão pra também postar em **Stories do Instagram**, junto com o mesmo gatilho.

Descoberto em pesquisa técnica (documentação oficial da Meta, 2026-07-30): a API de Publicação de Conteúdo do Instagram **não suporta legenda nem nenhum tipo de sticker** (link, enquete, localização) em Stories publicados via API — só imagem/vídeo puro. Isso significa que, diferente do feed, não é possível ter um link clicável ou texto nativo no Story publicado por automação. A única forma de mostrar informação (preço, cupom, nome do produto) é desenhar esse texto diretamente sobre a imagem antes de publicar.

## Escopo deste documento

**Dentro do escopo:**
- Gerar uma imagem de Story (proporção 9:16) com a foto do produto de fundo e uma faixa de degradê na parte de baixo, contendo: nome do produto, preço "de/por" (ou preço único) e cupom, quando houver.
- Postar essa imagem como Story no Instagram, no mesmo gatilho que já posta no feed.

**Fora do escopo (decisões já tomadas neste brainstorm):**
- **Link clicável ou "link na bio" no Story.** A API não permite sticker de link; o usuário decidiu não incluir nem uma menção textual de "link na bio" — o Story fica só com título/preço/cupom, sem call-to-action de link.
- **Stories no Facebook.** Este documento cobre só Instagram — Stories do Facebook (Página) ficam de fora por ora.
- **Vídeo ou Reels.** Só imagem estática, mesmo formato de mídia já usado no resto do projeto.
- **Qualquer tipo de sticker interativo** (enquete, pergunta, contagem regressiva) — tecnicamente impossível via API, não é uma decisão de escopo, é uma limitação da plataforma.

## Por que este approach (arquitetura)

**Gatilho:** o mesmo `POST /api/webhook` que já publica no blog e no feed do Instagram/Facebook passa a, depois de tentar o post de feed, também gerar e postar o Story — sem gatilho novo, mesmo padrão *best-effort* (falha no Story não afeta blog nem feed, sem retentativa automática).

**Como a imagem é gerada:** como o Instagram não aceita texto nativo em Stories, o texto precisa estar desenhado nos pixels da imagem antes do upload. Usamos **`@vercel/og`** — biblioteca da própria Vercel pra gerar imagens a partir de um layout declarado em JSX/CSS (flexbox), rodando via WebAssembly, sem dependência nativa problemática em função serverless (ao contrário de alternativas como `node-canvas`, que exigem compilação de binário nativo). A imagem é servida por uma rota própria (`GET /api/story-image`), que recebe os dados da promoção via query string e devolve o PNG já composto — o Instagram busca essa URL diretamente como `image_url` do Story, sem passo de upload intermediário nosso.

**Layout aprovado (via companheiro visual, comparando 3 opções lado a lado com uma foto de produto real):** faixa de degradê escuro na parte de baixo da imagem (sem bloco sólido cobrindo a foto), com nome do produto, preço "de" riscado + preço "por" em destaque, e cupom em uma etiqueta colorida — a foto do produto ocupa o resto do quadro sem cobertura.

## Arquitetura

```
POST /api/webhook (já existente, estendido)
  → pipeline atual (ML → Shopify) — inalterado
  → posta no feed do Facebook/Instagram — inalterado (sub-projeto anterior)
  → monta a URL de /api/story-image com os dados da promoção (query string)
  → postStoryToInstagram(storyImageUrl) — best-effort, try/catch isolado
      → POST /{ig-user-id}/media (media_type: STORIES, image_url: storyImageUrl)
      → espera o container ficar FINISHED (mesma lógica já usada no feed)
      → POST /{ig-user-id}/media_publish
  → resposta: { postUrl, facebook, instagram, story: {ok, postId?, error?} }

GET /api/story-image?imageUrl=...&title=...&price=...&discountedPrice=...&coupon=...
  → renderiza via @vercel/og: foto de fundo (imageUrl) + faixa de degradê
    embaixo com título/preço/cupom (layout aprovado)
  → devolve PNG 1080×1920
```

## Componentes

| Componente | Responsabilidade | Depende de |
|---|---|---|
| **Story Image Renderer** (`src/app/api/story-image/route.ts`) | Rota `GET` que recebe dados da promoção via query string e devolve um PNG 1080×1920 gerado com `@vercel/og`, no layout aprovado. | `@vercel/og` |
| **Instagram Stories Publisher** (`src/lib/social/instagram.ts`, estendido) | Nova função `postStoryToInstagram(imageUrl): Promise<SocialPostResult>` — reaproveita o fluxo de container + espera de status + publish já existente em `postToInstagram`, com `media_type: STORIES` e sem `caption`. | Graph API da Meta (mesmas credenciais já configuradas) |
| **Webhook** (`route.ts`, estendido) | Depois do post de feed, monta a URL de `/api/story-image` com os dados da promoção e chama `postStoryToInstagram`, incluindo `story: {ok, postId?, error?}` na resposta. | Story Image Renderer, Instagram Stories Publisher |

## Tratamento de erro

- Falha ao gerar a imagem do Story (ex: foto do produto inacessível pro `@vercel/og` buscar) ou falha ao postar o Story: capturada, reportada em `story: {ok:false, error:"..."}` na resposta do webhook, sem afetar o resultado do blog nem do feed. Sem retentativa automática.
- Mesma trava de configuração já usada pro feed: se as variáveis da Meta não estiverem configuradas, o Story (como o feed) é pulado silenciosamente com `{ok:false, error:'não configurado'}`, sem tentar nada.

## Testagem

- Testes unitários pra `postStoryToInstagram` (mock de `fetch`, mesmo padrão de `postToInstagram`).
- A rota `/api/story-image` não é facilmente testável por asserção de string — a validação do resultado é visual. Confere-se manualmente abrindo a URL gerada no navegador antes de testar contra o Instagram de verdade.
- Validação manual final: disparar o webhook com um produto real, conferir que o campo `story` da resposta veio `{ok:true}`, e conferir visualmente no Instagram que o Story saiu com a imagem e o texto corretos.

## Riscos conhecidos

- **`@vercel/og` é uma dependência nova no projeto** — precisa confirmar que renderiza corretamente fotos de produto de proporções variadas (algumas quadradas, outras retangulares) sem cortar informação importante da foto.
- **Tamanho/tempo de geração da imagem** — se a foto de fundo demorar pra carregar (CDN do Mercado Livre), a geração da imagem do Story pode ficar lenta; como é best-effort e não bloqueia o resto, o pior caso é só o Story atrasar ou falhar, não afetar blog/feed.
- **Texto muito longo** — nomes de produto muito compridos podem não caber bem na faixa de baixo; validação visual manual deve pegar isso nos primeiros testes reais.

## Próximos passos (fora deste documento)

TikTok (já registrado como sub-projeto futuro desde o brainstorm de Instagram/Facebook) e, se um dia fizer sentido, Stories no Facebook.
