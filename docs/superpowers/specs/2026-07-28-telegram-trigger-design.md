# PromoPost — Gatilho Telegram (captura de promoção de grupo)

## Contexto e motivação

O MVP validado (spec `2026-07-27-promopost-mvp-design.md`) cobre o pipeline central: um link de produto Mercado Livre entra via webhook, o sistema gera o link de afiliado, busca dado do produto e publica um rascunho no blog Shopify. Esse documento cobre o próximo sub-projeto: um **gatilho automático** que captura promoções compartilhadas num grupo de mensagens e alimenta esse mesmo pipeline, sem exigir ação manual a cada promoção.

O caso de uso real: o usuário participa de um grupo (hoje no WhatsApp, com conteúdo espelhado também no Telegram) onde promotores postam ofertas no formato "foto com marca d'água + frase solta + nome do produto + de R$X por R$Y + cupom + link (direto ou encurtado)". O objetivo é transformar essas mensagens automaticamente em posts no blog, sem o usuário precisar copiar/colar nada.

## Escopo deste documento

**Dentro do escopo:**
- Captura de mensagem via **Telegram** (grupo/canal onde o usuário é membro, não administrador).
- Extração de **link do produto, código de cupom (opcional) e preço com cupom aplicado (opcional)** a partir do texto livre da mensagem, via LLM.
- Exibição de preço "de/por" com cupom em destaque no post, quando a mensagem trouxer cupom.
- Reaproveitamento integral do pipeline Mercado Livre → Shopify já existente (webhook, geração de link de afiliado, scraping de produto, publicação).

**Fora do escopo (decisões já tomadas nesta rodada de brainstorm, não fazem parte deste documento):**
- **WhatsApp como gatilho.** Avaliado e descartado por ora: o WhatsApp não oferece API oficial para ler mensagens de um grupo em que o usuário é apenas membro; qualquer automação usaria biblioteca não-oficial, com risco real de banimento. Como o mesmo conteúdo é espelhado no Telegram — que tem uma API de cliente oficial (MTProto) que permite ler mensagens de qualquer chat que a conta já participa, sem precisar ser administrador —, o Telegram resolve o caso de uso sem esse risco. Fica registrado como possível trabalho futuro caso um dia seja estritamente necessário monitorar um grupo que exista *só* no WhatsApp.
- **Outros marketplaces** (Amazon, Shopee, Magalu). O extrator ignora qualquer mensagem cujo link não resolva para Mercado Livre. Suporte a outros marketplaces é um sub-projeto futuro separado, que exigirá sua própria automação de geração de link de afiliado por plataforma.
- Suporte a mais de um produto por mensagem.
- Retry automático de mensagem que falhou no pipeline (mesma filosofia do MVP: sem retry automático em nenhum passo).

## Por que este approach (arquitetura)

**Como o gatilho lê o Telegram:** o usuário é apenas membro do grupo/canal de origem, não administrador — não pode adicionar um bot comum (Bot API), que só recebe mensagens de chats onde foi explicitamente adicionado por um admin. A alternativa avaliada e escolhida é um **"userbot"**: logar com uma conta Telegram real (secundária, dedicada a isso) através da API de cliente oficial do Telegram (MTProto, via biblioteca GramJS), que enxerga tudo que essa conta já vê como membro comum — sem precisar de privilégio de administrador e sem violar termos de uso, já que é a mesma API que qualquer cliente oficial do Telegram usa.

**Como o gatilho roda:** como o Telegram exige uma conexão ativa para receber mensagens, e funções da Vercel não ficam permanentemente ligadas, o sistema usa **polling via Vercel Cron** (a cada ~3 minutos) em vez de escuta contínua: conecta, busca mensagens novas desde a última checagem, processa, desconecta. Foi avaliada a alternativa de um processo sempre ligado fora da Vercel (mais responsivo, mas sai do "tudo na Vercel" e soma custo/manutenção de infraestrutura nova) — descartada por ora, já que alguns minutos de atraso não fazem diferença prática para publicar uma promoção.

**Como o gatilho se conecta ao pipeline existente:** o poller não é um sistema paralelo — ele chama o **mesmo endpoint `POST /api/webhook`** que já existe, apenas com dois campos novos e opcionais no corpo da requisição (`coupon`, `discountedPrice`). Isso preserva a arquitetura original do projeto ("gatilho → webhook → pipeline") e evita duplicar a lógica de geração de link de afiliado, busca de produto e publicação.

## Arquitetura

```
Vercel Cron (a cada ~3min) → GET /api/telegram-poll
  → carrega sessão Telegram salva no Vercel Blob, conecta via GramJS
  → busca mensagens novas do chat alvo desde o cursor salvo (também no Blob)
  → para cada mensagem nova, em ordem:
      → Promo Extractor (LLM via Vercel AI Gateway):
          texto da mensagem → { isMercadoLivrePromo, link?, coupon?, discountedPrice? }
      → se isMercadoLivrePromo = false → ignora, segue para a próxima mensagem
      → se true → POST /api/webhook (chamada interna, mesmo domínio)
            body: { link, coupon?, discountedPrice? }
            header: x-promopost-secret (lido do próprio ambiente do servidor)
          → pipeline roda normalmente (busca produto, gera link de afiliado, publica rascunho)
          → o texto do post usa preço "de/por" com cupom quando `discountedPrice` vier preenchido,
            ou o preço único de sempre quando não vier
  → atualiza o cursor para o ID da última mensagem processada
  → desconecta do Telegram
```

Processa um lote limitado de mensagens por execução (ex: até 20) para não estourar o tempo da function; qualquer excedente fica para a próxima rodada do cron.

## Componentes

| Componente | Responsabilidade | Depende de |
|---|---|---|
| **Telegram Session Bootstrap** (`scripts/bootstrap-telegram-session.mjs`, local, manual) | Login único com número de telefone + código SMS + senha 2FA (se houver) via GramJS; salva a sessão resultante no Vercel Blob (`access: private`). Roda uma vez com a conta secundária dedicada, e novamente sempre que a sessão expirar. | GramJS, Vercel Blob |
| **Telegram Session Store** (`src/lib/telegram/sessionStore.ts`) | Lê a sessão salva do Vercel Blob para uso pelo poller. Espelha `sessionStore.ts` do Mercado Livre. | Vercel Blob |
| **Cursor Store** (`src/lib/telegram/cursorStore.ts`) | Lê/grava no Vercel Blob o ID da última mensagem do chat alvo já processada, para o poller só analisar mensagens novas a cada execução. | Vercel Blob |
| **Promo Extractor** (`src/lib/telegram/extractPromo.ts`) | Envia o texto da mensagem para um LLM (via Vercel AI Gateway) e retorna `{ isMercadoLivrePromo: boolean, link?: string, coupon?: string, discountedPrice?: number }`. Mensagens que não são promoção do Mercado Livre retornam `isMercadoLivrePromo: false`. | Vercel AI Gateway |
| **Telegram Poller** (`src/app/api/telegram-poll/route.ts`, acionado por Vercel Cron) | Conecta via GramJS usando a sessão salva, busca mensagens novas no chat alvo desde o cursor, roda cada uma pelo Promo Extractor, chama `POST /api/webhook` para cada promoção válida, atualiza o cursor ao final. | Session Store, Cursor Store, Promo Extractor, webhook existente |
| **Webhook + Pipeline** (`route.ts`, `pipeline.ts`, `template.ts` — já existentes, estendidos) | `route.ts` passa a aceitar `coupon` e `discountedPrice` opcionais no corpo da requisição; `pipeline.ts` repassa esses campos para `buildPostText`; `template.ts` ganha a lógica de exibir preço "de" (buscado no Mercado Livre, riscado) e "por" (com cupom, em destaque) mais o código do cupom, quando `discountedPrice` estiver presente — mantendo o comportamento atual (preço único) quando não estiver. | Componentes já existentes do MVP |

## Tratamento de erro

- **Sessão do Telegram expirada ou inválida** — o cron não processa nenhuma mensagem nessa execução e registra o erro; requer rodar o bootstrap novamente (mesmo conceito do `SESSION_EXPIRED` já existente para o Mercado Livre).
- **Falha do LLM ao extrair dados** (erro de API, resposta malformada) — tratada como "não é promoção"; a mensagem é ignorada e o processamento segue para a próxima. Uma falha do extrator não trava o lote inteiro.
- **Falha do webhook para uma mensagem específica** (ex: produto não elegível para o Programa de Afiliados, Shopify fora do ar) — o erro é registrado junto com o texto original da mensagem, para permitir reprocessamento manual posterior, mas **o cursor avança mesmo assim** — sem retry automático, mantendo a mesma filosofia do pipeline original. Isso implica que uma mensagem cujo processamento falhe no meio (por exemplo, timeout da function antes de atualizar o cursor) pode ser reprocessada uma única vez na execução seguinte; não há garantia de idempotência mais forte que essa nesta fase.
- **Acúmulo de mensagens** — cada execução processa no máximo um lote fixo de mensagens; o restante é processado nas execuções seguintes do cron.

## Testagem

- **Promo Extractor**: testes unitários com a chamada ao LLM mockada, cobrindo: promoção do Mercado Livre com cupom, promoção do Mercado Livre sem cupom, mensagem de outro marketplace (deve ser ignorada), mensagem que não é promoção nenhuma.
- **Session Store / Cursor Store (Telegram)**: testes unitários mockando o Vercel Blob, espelhando os testes já existentes dos equivalentes do Mercado Livre.
- **Telegram Poller**: a lógica de orquestração (decidir quais mensagens processar, quando chamar o webhook, quando atualizar o cursor) é testada com o cliente GramJS mockado. A conexão real ao Telegram não é testável automaticamente — mesma limitação já aceita para a automação Playwright do Mercado Livre.
- **`template.ts` (preço de/por com cupom)**: testes unitários cobrindo o caso com `discountedPrice` presente (formato "de/por" + cupom) e o caso sem (comportamento atual inalterado).
- **Validação manual**: após configurado, envia uma mensagem de teste no grupo/canal de origem, aciona a rota do poller manualmente (`curl`) e confere se o post saiu correto no blog.

## Riscos conhecidos

- **Uso de uma conta Telegram real para automação (userbot).** Embora seja uma API oficial do Telegram e o risco de banimento por leitura passiva seja considerado baixo, ainda é uma forma de automação de conta pessoal; usar uma conta secundária dedicada (não a principal do usuário) limita o impacto caso a conta seja restringida.
- **Atraso de até ~3 minutos** entre a mensagem chegar no grupo e o post ser publicado, inerente ao modelo de polling.
- **Extração via LLM não é 100% confiável** — mensagens ambíguas ou muito fora do padrão podem ser mal classificadas (falso positivo ou falso negativo). Não há revisão humana antes da publicação nesta fase — o artigo Shopify é sempre criado como rascunho (comportamento já existente no MVP), então uma extração equivocada só chega a publicar de verdade se o usuário revisar e publicar manualmente.
- **Sem garantia forte de idempotência** — uma falha no meio do processamento de uma mensagem pode causar reprocessamento único dela na execução seguinte do cron.

## Próximos passos (fora deste documento)

Depois de validado este gatilho Telegram para Mercado Livre, os sub-projetos seguintes (cada um com seu próprio spec) devem cobrir, em ordem a decidir: suporte a Shopee/Amazon/Magalu (cada um com sua própria automação de link de afiliado), publicação em Instagram/TikTok, e — caso realmente necessário — reavaliação do gatilho WhatsApp com as mitigações de risco discutidas (conta secundária, biblioteca que implementa o protocolo oficial multi-dispositivo, uso somente leitura).
