# PromoPost — Amazon como terceiro marketplace

## Contexto e motivação

O PromoPost hoje suporta dois marketplaces (Mercado Livre e Shopee): captura links no canal do Telegram, extrai dados do produto, gera um link de afiliado, e publica no blog Shopify + redes sociais. Este documento cobre a extensão pra suportar a **Amazon** como terceiro marketplace, conforme previsto desde o spec original do MVP.

O usuário já tem conta de Associado Amazon aprovada, mas **não tem acesso à Product Advertising API (PA-API)** — a Amazon exige pelo menos 10 vendas qualificadas nos últimos 30 dias pra liberar esse acesso (confirmado direto na documentação da Amazon durante este brainstorm), e a conta ainda não tem nenhuma venda. Isso descarta a API oficial como caminho pra buscar dados de produto — o design abaixo assume scraping da própria página, seguindo o mesmo padrão já usado pro Mercado Livre e pela Shopee.

## Escopo deste documento

**Dentro do escopo:**
- Detectar automaticamente se um link recebido (depois de resolvido) é da Amazon (`amazon.com.br`), somando aos dois marketplaces já suportados.
- Extrair título/preço/imagem de produtos da Amazon via scraping da própria página, reaproveitando a sessão de browser já aberta pra resolver o redirect.
- Gerar o link de afiliado da Amazon **sem chamada de API** — só garantindo o parâmetro `?tag=<AMAZON_ASSOCIATE_TAG>` na URL resolvida do produto. O Associate Tag (`crpablo0d-20`) é um identificador público do programa de afiliados, não um segredo, mas continua configurável via variável de ambiente pra não ficar hardcoded.

**Fora do escopo (decisões já tomadas neste brainstorm):**
- **Product Advertising API (PA-API).** Bloqueada pela própria Amazon até a conta acumular 10 vendas qualificadas em 30 dias — não é uma escolha de arquitetura, é uma restrição externa. Se a conta algum dia qualificar, migrar pra PA-API pode valorizar a pena (dados mais confiáveis, sem risco de bloqueio por scraping), mas isso fica pra um sub-projeto futuro, fora deste documento.
- **Encurtador de link próprio (SiteStripe / amzn.to).** A Amazon oferece um serviço de link curto pros afiliados, mas exigiria uma chamada de API adicional sem necessidade real — o link com `?tag=` já é um link de afiliado válido e rastreável por si só, sem precisar de encurtamento.
- **Normalização da URL pra formato canônico `/dp/{ASIN}`.** URLs da Amazon costumam vir com vários parâmetros de tracking (`ref=`, `pd_rd_*`, etc.). Poderia extrair só o ASIN e montar uma URL limpa, mas isso é complexidade extra sem benefício real pro afiliado — o parâmetro `tag` funciona igual em qualqumer variação da URL. Mesma filosofia minimalista já usada pra Shopee (que também não normaliza a URL antes de gerar o link).

## Por que este approach (arquitetura)

O mesmo script Playwright que já resolve o redirect e faz o roteamento por marketplace (Mercado Livre → Shopee → erro) ganha um terceiro branch. Depois de resolver o redirect e confirmar que o destino é `amazon.com.br`, o script:
1. Extrai título/preço/imagem da própria página (scraping, mesma sessão de browser já aberta).
2. Monta o link de afiliado só ajustando a query string da URL resolvida — sem segunda chamada de rede, sem assinatura, sem sessão logada.

**O desafio real não é arquitetura, é robustez contra bloqueio.** Diferente do Mercado Livre (que bloqueava Chromium headless "puro" mas foi resolvido escondendo `navigator.webdriver` e usando user-agent real) e da Shopee (que não apresentou esse problema), a Amazon é conhecida por ter detecção anti-bot mais agressiva — a mesma configuração de browser já usada pros outros dois marketplaces é o ponto de partida, mas pode precisar de ajuste adicional (delays, headers extras) só confirmável testando contra a Amazon real.

**Por que o preço precisa de um seletor diferente dos outros dois marketplaces:** páginas de produto da Amazon normalmente não expõem `meta[itemprop=price]` nem `product:price:amount` de forma confiável (testado indiretamente via padrão conhecido de terceiros, já que a extração ao vivo só será validada na implementação) — o valor formatado do preço fica num elemento visual/acessível (`.a-price .a-offscreen`), então esse é o seletor primário, com as meta tags dos outros marketplaces como fallback caso a página mude ou o layout varie por categoria de produto.

## Arquitetura

```
POST /api/webhook { link, coupon?, discountedPrice? }
  → fetchProductAndAffiliateLink(link):
      → resolve redirect (HTTP ou client-side JS) até o destino final
        — mesmo passo já existente, sem mudança
      → confere o hostname resolvido:
          - mercadolivre.com.br / mercadolibre.com → fluxo atual
          - shopee.com.br → fluxo atual
          - amazon.com.br (NOVO)
              → extrai título/preço/imagem via scraping da página
                (reaproveita a sessão de browser já aberta)
              → checa AMAZON_ASSOCIATE_TAG configurada
              → monta affiliateLink = URL resolvida + query param
                tag=<AMAZON_ASSOCIATE_TAG> (adiciona ou sobrescreve)
          - outro domínio → erro MARKETPLACE_NOT_SUPPORTED
      → retorna { product: {title, price, imageUrl}, affiliateLink }
        — mesmo formato de sempre, resto do pipeline não muda
  → buildPostText, Shopify Publisher, postToSocialNetworks
      — nenhuma mudança, já são agnósticos de marketplace
```

## Componentes

| Componente | Responsabilidade | Depende de |
|---|---|---|
| **Marketplace Detector** (dentro do script Playwright existente) | Passa a reconhecer `amazon.com.br` como terceiro destino válido, além de Mercado Livre e Shopee. | Playwright (já usado hoje) |
| **Amazon Product Scraper** (novo, mesmo script) | Extrai título (`h1`, fallback `og:title`), preço (`.a-price .a-offscreen`, fallback meta tags), imagem (`og:image`) da página de produto Amazon. | Playwright |
| **Amazon Affiliate Link Builder** (novo, função pura, testável isoladamente) | Recebe a URL resolvida do produto e o Associate Tag, devolve a mesma URL com o parâmetro `tag` adicionado ou sobrescrito. Sem rede, sem estado. | — |
| **Product type compartilhado** (`src/lib/marketplace/types.ts`) | Campo `marketplace` ganha `'amazon'` como terceiro valor possível de `'mercadolivre' \| 'shopee' \| 'amazon'`. | — |
| **Webhook / Pipeline** (`affiliateLink.ts`) | Mapeia `AMAZON_CREDENTIALS_MISSING` (Associate Tag ausente) pro mesmo padrão de erro já usado pra Shopee. | — |

## Fluxo de dado

Idêntico ao pipeline já documentado (`POST /api/webhook` → `fetchProductAndAffiliateLink` → `buildPostText` → `publishArticle` (Shopify) → `postToSocialNetworks`). Nenhuma mudança no formato de entrada/saída de nenhuma rota — só um terceiro caminho dentro de `fetchProductAndAffiliateLink`.

## Tratamento de erro

- **`AMAZON_CREDENTIALS_MISSING`** — `AMAZON_ASSOCIATE_TAG` não configurada, reportado assim que o marketplace é identificado como Amazon, antes de gastar tempo com scraping. Mesmo padrão de severidade já usado pra `SHOPEE_CREDENTIALS_MISSING` (interrompe o pipeline inteiro, sem produto, sem post).
- **`PRODUCT_NOT_FOUND`** — reaproveitado sem mudança, mesmo critério (título, preço ou imagem ausente após tentar todos os seletores).
- **`MARKETPLACE_NOT_SUPPORTED`** — continua cobrindo qualquer domínio que não seja Mercado Livre, Shopee, nem Amazon.
- **Sem `SESSION_EXPIRED` equivalente** — a Amazon não precisa de sessão logada pra gerar o link (diferente do Mercado Livre), então esse código de erro simplesmente não se aplica ao branch Amazon.

## Testagem

- **Amazon Affiliate Link Builder**: função pura, testada isoladamente com casos determinísticos — URL sem query string, URL com outros parâmetros existentes, URL que já tem um `tag` diferente (deve sobrescrever, não duplicar).
- **Orquestrador TS** (`affiliateLink.ts`): testes unitários com mock do resultado do script, cobrindo os novos casos (`AMAZON_CREDENTIALS_MISSING`, sucesso com `marketplace: 'amazon'`), seguindo o mesmo padrão dos testes já existentes.
- **Script Playwright**: sem teste automatizado (mesma limitação já aceita pros outros dois marketplaces). Validação manual com 2-3 links reais da Amazon antes de considerar pronto — maior chance de exigir ajuste aqui do que nos marketplaces anteriores, dado o histórico de bloqueio mais agressivo da Amazon contra automação.
- **Ponta a ponta**: uma execução real completa com um link Amazon real (link → post em rascunho no Shopify + redes sociais).

## Riscos conhecidos

- **Bloqueio anti-bot da Amazon.** É o maior risco deste sub-projeto — a mesma configuração de Chromium que já funciona pro Mercado Livre (esconder `navigator.webdriver`, user-agent real, flags de automação desabilitadas) é o ponto de partida, mas a Amazon pode exigir mais (delays entre ações, comportamento de mouse/scroll simulado, rotação de IP). Só confirma testando contra produtos reais — mesmo padrão de descoberta iterativa já visto no Mercado Livre e no TikTok.
- **Seletor de preço (`.a-price .a-offscreen`) pode variar por categoria de produto ou layout A/B da Amazon.** Não há como confirmar isso sem testar múltiplos produtos reais de categorias diferentes.
- **Allowlist de imagem** pros proxies de Story/TikTok (`ALLOWED_IMAGE_HOSTS`) precisa incluir o domínio de CDN de imagem da Amazon (provavelmente `m.media-amazon.com` ou `images-na.ssl-images-amazon.com` — confirmar o domínio real na primeira extração bem-sucedida) — mesmo tipo de lacuna que já aconteceu com a Shopee (`susercontent.com` esquecido na primeira versão).
- **Associate Tag errado ou mal formado** não gera erro nenhum do lado da Amazon (o link continua funcionando, só sem crédito de comissão pro afiliado) — não há como validar programaticamente que o `tag` está correto, só checando manualmente que as vendas aparecem no painel de Associados depois.

## Próximos passos (fora deste documento)

Depois desta integração, o roadmap original do MVP ainda lista: gatilho via WhatsApp, geração de texto do post via LLM (hoje ainda é template fixo), e migração pra arquitetura de fila assíncrona — nenhum desses é abordado aqui. Migrar pra PA-API fica como possibilidade futura, condicionada à conta acumular as 10 vendas qualificadas em 30 dias exigidas pela Amazon.
