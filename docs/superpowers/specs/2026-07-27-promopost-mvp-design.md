# PromoPost — MVP: fluxo mínimo ponta-a-ponta (Mercado Livre → Blog Shopify)

## Contexto e visão de produto

PromoPost é uma ferramenta que, a partir de um gatilho (mensagem em grupo de WhatsApp, mensagem no Telegram, webhook, etc.), publica automaticamente ofertas de marketplaces (Mercado Livre, Shopee, Amazon, etc.) em redes sociais (Instagram, TikTok) e em um site no estilo blog, usando o link de afiliado do autor em vez do link original do produto.

O projeto completo é grande demais para um único ciclo de design/implementação — envolve múltiplos gatilhos de entrada, múltiplos marketplaces, geração de conteúdo e múltiplos destinos de publicação, cada um com sua própria complexidade de integração. Este documento cobre apenas o primeiro sub-projeto: um fluxo mínimo ponta-a-ponta que valida a arquitetura central antes de expandir para os demais gatilhos, marketplaces e destinos.

## Escopo deste MVP

**Dentro do escopo:**
- 1 gatilho: webhook HTTP recebendo um link puro de produto do Mercado Livre.
- 1 marketplace: Mercado Livre.
- 1 destino de publicação: o blog existente do usuário, hospedado no Shopify.
- Texto do post gerado por template fixo (sem LLM).
- Hospedagem 100% Vercel (função serverless + Vercel Sandbox + Vercel Blob).

**Fora do escopo (fases futuras, não faz parte deste documento):**
- Gatilhos via WhatsApp e Telegram (parsing de texto livre com link embutido).
- Outros marketplaces (Shopee, Amazon).
- Publicação em redes sociais (Instagram, TikTok).
- Geração de conteúdo via LLM.
- Fila assíncrona / worker separado (Approach B) — natural evolução quando os gatilhos em tempo real (WhatsApp/Telegram) exigirem resposta rápida do webhook.
- Retry automático de falhas.
- Deduplicação de posts / histórico persistente de publicações.

## Por que este approach (arquitetura)

Foram avaliadas três abordagens de arquitetura:

- **A — Função única síncrona** (escolhida): um único endpoint Vercel executa todo o pipeline numa chamada só. Mais simples de construir e depurar; adequado ao volume baixo de um MVP validando a arquitetura.
- **B — Fila assíncrona (webhook + worker separado):** webhook só enfileira, worker processa depois. Mais resiliente (retry, sem risco de timeout), mas é complexidade desnecessária antes de existir um gatilho em tempo real (WhatsApp/Telegram) que realmente precise de resposta rápida.
- **C — Automação de browser em serviço externo dedicado:** isola a parte frágil (Playwright logado) num serviço sempre ligado fora da Vercel. Reduz risco de limites serverless, mas contraria a preferência do usuário por manter tudo na Vercel e soma custo/manutenção de infraestrutura extra.

A decisão foi seguir com **A** agora, migrando para **B** quando um gatilho em tempo real for adicionado, e reavaliando **C** apenas se a automação de browser na Vercel se mostrar inviável na prática.

## Arquitetura

Um endpoint HTTP na Vercel (`POST /api/webhook`) recebe `{ link }`, protegido por um secret compartilhado enviado em um header de autenticação. Dentro da mesma execução (síncrona), roda quatro passos em sequência:

1. **Buscar dado do produto** — extrai o ID do item a partir do link do Mercado Livre e consulta a API pública `api.mercadolibre.com/items/{id}` para obter título, preço e imagem.
2. **Gerar link de afiliado** — usa Vercel Sandbox para subir um Chromium headless controlado por Playwright, que carrega uma sessão logada previamente salva (Vercel Blob), acessa o painel de afiliados do Mercado Livre, cola o link do produto e extrai o link curto gerado (`mercadolivre.com/sec/...`).
3. **Montar o texto do post** — aplica um template fixo (`[TÍTULO] por R$[PREÇO] — confira: [LINK_AFILIADO]`) sobre os dados coletados.
4. **Publicar no blog** — chama a Shopify Admin API (`articleCreate`) para criar um artigo no blog existente, usando o texto montado e a imagem do produto.

A resposta final ao chamador do webhook é síncrona: sucesso (com a URL do post criado) ou erro (identificando em qual passo o pipeline falhou).

## Componentes

| Componente | Responsabilidade | Depende de |
|---|---|---|
| **Webhook handler** (`/api/webhook`) | Valida o secret no header, orquestra os passos 2–5 em ordem, monta a resposta final. | — |
| **Product Fetcher** | Extrai o ID do item a partir do link do Mercado Livre; consulta `api.mercadolibre.com/items/{id}`; retorna `{ título, preço, imagemUrl }`. | API pública do Mercado Livre |
| **Affiliate Link Generator** | Sobe uma Vercel Sandbox e roda um script Playwright: carrega a sessão salva (cookie) do Vercel Blob, acessa o painel de afiliados, cola o link do produto, extrai o link `/sec/...` gerado. Retorna um erro específico (`SESSION_EXPIRED`) quando a sessão carregada não é mais válida, em vez de travar silenciosamente. | Vercel Sandbox, Session Store |
| **Content Templater** | Função pura `(produto, linkAfiliado) → texto`, aplicando o template fixo. | — |
| **Shopify Publisher** | Chama a Shopify Admin API (`articleCreate`) enviando título, corpo e imagem; retorna a URL do post criado. | Shopify Admin API |
| **Session Store** | Guarda no Vercel Blob a sessão/cookie logada do painel de afiliados do Mercado Livre. Exige um bootstrap manual único (o usuário loga uma vez; o sistema salva a sessão resultante) e é somente lida pelo Affiliate Link Generator nas execuções seguintes. | Vercel Blob |

Ordem de dependência: o Webhook handler chama o Product Fetcher, que alimenta o Affiliate Link Generator e o Content Templater; o Affiliate Link Generator também alimenta o Content Templater; o Content Templater alimenta o Shopify Publisher.

## Fluxo de dado

```
POST /api/webhook { link: "https://mercadolivre.com.br/produto-x" }
  → valida secret no header (401 se inválido)
  → Product Fetcher: link → item ID → GET api.mercadolibre.com/items/{id}
      → { título, preço, imagemUrl }
  → Affiliate Link Generator: link do item → Sandbox + Playwright (usa sessão do Blob)
      → linkAfiliado ("mercadolivre.com/sec/xxxx")
  → Content Templater: (título, preço, linkAfiliado) → texto do post
  → Shopify Publisher: (texto, imagemUrl) → articleCreate → postUrl
  → resposta 200 { postUrl } ou 4xx/5xx { passo, erro }
```

A execução inteira é síncrona, uma chamada, sem estado entre requisições — exceto a sessão do Mercado Livre no Vercel Blob, que persiste entre chamadas.

## Tratamento de erro

Cada passo pode falhar isoladamente; uma falha não derruba o serviço, apenas aquela requisição falha e reporta em qual passo ocorreu:

- **Secret inválido** → `401`, nenhum passo executa.
- **Link não é do Mercado Livre ou ID não extraível** → `400`, erro claro ("link inválido").
- **Product Fetcher falha** (item não existe, API fora do ar) → `502`, `passo: "product_fetch"`.
- **Affiliate Link Generator falha por sessão expirada** → `502`, `passo: "affiliate_link"`, `erro: "SESSION_EXPIRED"` — aviso claro de que a sessão precisa ser re-bootstrapada manualmente.
- **Affiliate Link Generator falha por outro motivo** (painel mudou de layout, timeout) → `502`, `passo: "affiliate_link"`, erro genérico + log detalhado (inclui screenshot da página no momento da falha, para depuração).
- **Shopify Publisher falha** (token inválido, rate limit) → `502`, `passo: "shopify_publish"`.

Não há retry automático neste MVP: uma falha aparece na resposta do webhook e o reenvio é manual. Retry automático fica para a versão com fila assíncrona (Approach B, fase futura).

## Testagem

- **Product Fetcher + Content Templater**: testes unitários com mock da resposta da API do Mercado Livre, cobrindo variações de formato de link (com querystring, link curto, link com parâmetros de rastreamento) e o texto final gerado pelo template.
- **Shopify Publisher**: teste unitário com mock da API. Validação manual real cria o artigo como **rascunho** (não publicado), evitando poluir o blog real durante os testes; a primeira publicação real é feita manualmente pelo usuário.
- **Affiliate Link Generator**: difícil de cobrir com teste unitário por depender de Playwright e de uma sessão real. Validação por execução manual contra 2–3 links reais, com captura automática de screenshot em caso de falha para facilitar o diagnóstico (timeout, mudança de layout do painel).
- **Ponta a ponta**: uma execução real completa (link real → post em rascunho no Shopify), conferindo que cada passo do pipeline funcionou.

Não há CI automatizado neste MVP — a validação é manual/local antes de considerar o fluxo pronto.

## Riscos conhecidos

- **Mercado Livre não tem API oficial de afiliados.** A geração do link depende de automação de browser contra o painel manual, o que é frágil a mudanças de layout do site e pode quebrar sem aviso.
- **Sessão do painel de afiliados pode expirar** (logout forçado, mudança de senha, detecção de automação), exigindo re-bootstrap manual da sessão salva no Vercel Blob.
- **Vercel Sandbox rodando Chromium headless** tem custo e tempo de execução maiores que uma função comum; o tempo total do pipeline (busca de produto + browser automation + publicação) precisa ficar dentro do timeout de função da Vercel (atualmente 300s por padrão), o que é folgado para uma execução, mas deve ser observado se o Mercado Livre ficar lento.

## Próximos passos (fora deste documento)

Após validar este fluxo mínimo funcionando ponta-a-ponta, os sub-projetos seguintes (cada um com seu próprio spec) devem cobrir, em alguma ordem a decidir: gatilhos via WhatsApp/Telegram, suporte a Shopee e Amazon, publicação em Instagram/TikTok, geração de conteúdo via LLM, e migração para arquitetura com fila assíncrona (Approach B).
