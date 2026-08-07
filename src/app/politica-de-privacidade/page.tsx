export default function PoliticaDePrivacidadePage() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px', lineHeight: 1.6 }}>
      <h1>Política de Privacidade</h1>
      <p>Última atualização: agosto de 2026.</p>

      <p>
        O PromoPost é uma ferramenta de automação de uso interno da Tobie Store, sem
        cadastro público de usuários. Esta política descreve como os dados que passam pelo
        serviço são tratados.
      </p>

      <h2>Dados processados</h2>
      <p>
        O serviço lê mensagens de promoções (texto e imagens de produtos) de um canal de
        Telegram controlado pela Tobie Store. Nenhum dado pessoal de terceiros é coletado,
        armazenado ou compartilhado — o conteúdo processado é limpo de informação
        promocional pública (título, preço e imagem de produto).
      </p>

      <h2>Contas conectadas</h2>
      <p>
        O serviço se autentica, via OAuth oficial, apenas nas próprias contas da Tobie Store
        no Facebook, Instagram, TikTok e Shopify, para publicar conteúdo nessas contas. Os
        tokens de acesso são armazenados de forma privada, em infraestrutura própria da
        Tobie Store, e não são compartilhados com terceiros.
      </p>

      <h2>TikTok</h2>
      <p>
        Ao usar o TikTok Login Kit e o Content Posting API, o PromoPost acessa somente as
        informações mínimas necessárias para publicar conteúdo na conta autorizada da Tobie
        Store (ex.: opções de privacidade disponíveis para a publicação), e não acessa,
        processa ou armazena dados pessoais de outros usuários do TikTok.
      </p>

      <h2>Contato</h2>
      <p>
        Dúvidas sobre esta política: <a href="mailto:crpablo@gmail.com">crpablo@gmail.com</a>
      </p>
    </main>
  );
}
