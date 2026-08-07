export default function TermosDeUsoPage() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px', lineHeight: 1.6 }}>
      <h1>Termos de Uso</h1>
      <p>Última atualização: agosto de 2026.</p>

      <p>
        O PromoPost é uma ferramenta de automação de uso interno da Tobie Store. Ele não é
        distribuído a terceiros, não possui cadastro de usuários e não é vendido ou licenciado
        como produto — é operado exclusivamente pela Tobie Store para publicar suas próprias
        promoções.
      </p>

      <h2>O que o serviço faz</h2>
      <p>
        Monitora um canal de Telegram controlado pela Tobie Store em busca de promoções de
        marketplaces parceiros, extrai título, preço e imagem do produto, gera um link de
        afiliado da Tobie Store e publica o conteúdo resultante no blog da Tobie Store e nas
        contas oficiais da Tobie Store no Facebook, Instagram e TikTok.
      </p>

      <h2>Integrações de terceiros</h2>
      <p>
        O serviço se conecta às APIs oficiais do Meta (Facebook e Instagram) e do TikTok
        (Login Kit e Content Posting API) exclusivamente para publicar conteúdo nas contas
        de propriedade da Tobie Store, autorizadas previamente via OAuth pelo próprio
        administrador da conta.
      </p>

      <h2>Contato</h2>
      <p>
        Dúvidas sobre estes termos: <a href="mailto:crpablo@gmail.com">crpablo@gmail.com</a>
      </p>
    </main>
  );
}
