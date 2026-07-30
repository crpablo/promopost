# PromoPost — Postagem no TikTok

## Contexto e motivação

O projeto já publica cada promoção capturada no Telegram no blog Shopify, no feed do Facebook e Instagram, e em Stories do Instagram (specs anteriores). Este documento cobre a extensão pra também postar no TikTok, junto com o mesmo gatilho.

## Escopo deste documento

**Dentro do escopo:**
- Postar um post de foto (`media_type: PHOTO`) no TikTok — título (produto) + descrição (preço de/por + cupom + link + hashtags, mesmo texto usado no Instagram/Facebook) + a foto do produto.
- Fluxo de autenticação OAuth (login único, renovação automática preguiçosa de token).
- Submissão do app pra auditoria da TikTok, em paralelo à construção (não é um bloqueio pra começar a construir).

**Fora do escopo (decisões já tomadas neste brainstorm):**
- **Vídeo.** A API aceita foto (`media_type: PHOTO`), então não precisamos gerar vídeo — usamos a mesma foto do produto já usada nas outras redes.
- **Link clicável na descrição.** Confirmado via pesquisa: a API padrão de Content Posting não oferece campo de link clicável (`landing_page_url` ou similar) pra posts de foto/vídeo comuns — só texto. Mesmo tratamento do Instagram: link em texto + "também no link da bio".
- **Renovação de token via cron dedicado.** Optou-se por renovação preguiçosa (checar e renovar só na hora de postar) em vez de um job agendado — evita infraestrutura nova.
- **Carrossel de múltiplas fotos.** A API aceita até 35 fotos por post; usamos só 1 (a mesma foto do produto), consistente com o resto do projeto.

## Por que este approach (arquitetura)

**Gatilho:** o mesmo `POST /api/webhook` que já publica nas outras redes, como mais um passo *best-effort* independente — falha no TikTok não afeta blog, feed, nem Story, e vice-versa.

**Autenticação:** diferente da Meta (token de Usuário do Sistema, permanente), a API do TikTok exige OAuth por conta, com um token de acesso que expira em 24h e um token de renovação que expira em 365 dias. Em vez de manter os dois sempre atualizados via um cron dedicado, a renovação acontece de forma preguiçosa: a cada chamada de postagem, o publisher confere se o token de acesso está perto de expirar e, se estiver, renova antes de prosseguir, salvando o novo par de volta no Vercel Blob. Isso espelha o padrão de sessão já usado pro Mercado Livre e pro Telegram (sessão salva no Blob, script de bootstrap local pra gerar a primeira vez), só que com renovação automática em vez de expiração que exige bootstrap manual de novo — o bootstrap manual só volta a ser necessário se o refresh token em si expirar (365 dias) ou for revogado.

**Auditoria da TikTok:** a API exige que o app passe por um processo de auditoria antes de permitir posts públicos — até lá, todo post sai como `privacy_level: SELF_ONLY` (visível só pra própria conta). Isso é uma restrição da plataforma, não uma escolha do projeto. A decisão tomada é **construir a integração completa e submeter pra auditoria assim que possível**, em vez de esperar a aprovação pra começar — assim o tempo de espera da TikTok corre em paralelo ao desenvolvimento e validação, não depois.

**Verificação de domínio:** a TikTok exige verificar a propriedade do domínio de onde as imagens são buscadas antes de aceitar URLs desse domínio — um passo de configuração único (documentado na seção de setup do runbook, análogo à verificação de domínio do Google Search Console).

## Arquitetura

```
POST /api/webhook (já existente, estendido)
  → pipeline + Shopify + Facebook + Instagram feed + Instagram Story (inalterados)
  → postToTikTok(product.imageUrl, title, description) — best-effort
      → carrega token salvo no Vercel Blob
      → se o access token estiver perto de expirar, renova com o refresh
        token (POST /v2/oauth/token/), salva o novo par de volta no Blob
      → POST /v2/post/publish/content/init/
          body: { post_info: { title, description, privacy_level },
                   source_info: { source: "PULL_FROM_URL",
                                   photo_images: [product.imageUrl],
                                   photo_cover_index: 0 },
                   media_type: "PHOTO", post_mode: "DIRECT_POST" }
  → resposta: { postUrl, facebook, instagram, story, tiktok: {ok, error?} }
```

## Componentes

| Componente | Responsabilidade | Depende de |
|---|---|---|
| **TikTok Token Store** (`src/lib/social/tiktokTokenStore.ts`) | `loadTikTokToken(): Promise<{accessToken, refreshToken, expiresAt}>` e `saveTikTokToken(tokens): Promise<void>`, lendo/gravando no Vercel Blob. Espelha o padrão já usado pra sessão do Mercado Livre e do Telegram. | Vercel Blob |
| **TikTok Bootstrap** (`scripts/bootstrap-tiktok-token.mjs`, local, manual) | Login único via OAuth: abre a URL de autorização da TikTok, você loga com a conta secundária/comercial e autoriza, o script troca o código de autorização pelo primeiro par de tokens e salva no Blob. Roda uma vez; de novo só se o refresh token expirar ou for revogado. | TikTok OAuth |
| **TikTok Publisher** (`src/lib/social/tiktok.ts`) | `postToTikTok(imageUrl: string, title: string, description: string): Promise<SocialPostResult>` — renova o token se necessário (via Token Store), depois chama a Content Posting API com `media_type: PHOTO`. | TikTok Token Store, Content Posting API |
| **Webhook** (`route.ts`, estendido) | Depois dos outros posts sociais, monta título (produto, truncado em 90 caracteres — limite da API) e descrição (mesmo formato de/por + cupom + link + hashtags das outras redes), chama `postToTikTok`, inclui `tiktok: {ok, error?}` na resposta. | TikTok Publisher |

## Tratamento de erro

- Falha ao renovar o token, ao postar, ou refresh token expirado/revogado (exige rodar o bootstrap de novo): capturada, reportada em `tiktok: {ok:false, error:"..."}` na resposta do webhook, sem afetar blog/feed/Story. Sem retentativa automática — mesma filosofia do resto do projeto.
- Mesmo padrão dos outros: se as variáveis do TikTok não estiverem configuradas, o passo é pulado com `{ok:false, error:'não configurado'}`, sem tentar nada.

## Testagem

- Testes unitários pro `tiktokTokenStore` (mock do Vercel Blob) e pro `TikTok Publisher` (mock de fetch), cobrindo: postar com token válido sem precisar renovar, renovar automaticamente um token perto de expirar antes de postar, falha na renovação, falha ao postar.
- Validação manual final: rodar o bootstrap com a conta real, configurar as variáveis de ambiente, disparar o webhook com um produto real, conferir `tiktok: {ok:true}` na resposta e ver o post (privado, até a auditoria da TikTok aprovar) na conta.

## Riscos conhecidos

- **Posts ficam privados até a TikTok aprovar o app** — sem previsão de prazo. O valor real da integração só aparece depois da aprovação; até lá, serve pra validar que o pipeline técnico funciona.
- **Token de renovação expira em 365 dias** — se o projeto ficar muito tempo sem postar nada no TikTok (improvável, dado o volume do canal), pode expirar sem perceber, exigindo bootstrap manual de novo.
- **Verificação de domínio é um pré-requisito não testado ainda** — o processo exato (arquivo de verificação, registro DNS, etc.) só será confirmado na prática durante a configuração.
- **Título limitado a 90 caracteres** — nomes de produto do Mercado Livre costumam ser longos; truncar pode cortar informação relevante. A descrição (4000 caracteres) tem espaço de sobra pro resto.

## Próximos passos (fora deste documento)

Nenhum sub-projeto de rede social novo está planejado depois deste — próximos passos ficam a critério do usuário quando esta integração estiver validada.
