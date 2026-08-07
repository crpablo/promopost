export default function HomePage() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px', lineHeight: 1.6 }}>
      <h1>PromoPost</h1>
      <p>
        PromoPost é uma automação interna da Tobie Store que identifica promoções de marketplaces
        (Mercado Livre, Shopee, Amazon, Magalu) e publica o conteúdo, com o link de afiliado da
        Tobie Store, no blog da loja e nas redes sociais oficiais da Tobie Store (Facebook,
        Instagram e TikTok).
      </p>
      <p>
        Este serviço é operado por um único negócio (Tobie Store) e não oferece cadastro,
        login ou conta para terceiros — é uma ferramenta de uso interno.
      </p>
      <p>
        <a href="/termos-de-uso">Termos de Uso</a> · <a href="/politica-de-privacidade">Política de Privacidade</a>
      </p>
      <p>
        Contato: <a href="mailto:crpablo@gmail.com">crpablo@gmail.com</a>
      </p>
    </main>
  );
}
