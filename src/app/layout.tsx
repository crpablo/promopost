export const metadata = {
  title: 'PromoPost — Tobie Store',
  description: 'Automação de publicação de promoções da Tobie Store.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', color: '#1a1a1a', background: '#fff' }}>
        {children}
      </body>
    </html>
  );
}
