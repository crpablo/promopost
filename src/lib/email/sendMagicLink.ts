import { Resend } from 'resend';

export async function sendMagicLink({ to, url }: { to: string; url: string }): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.EMAIL_FROM ?? 'PromoPost <login@promopost.tobiestore.com.br>';

  const { error } = await resend.emails.send({
    from,
    to,
    subject: 'Seu link de acesso ao PromoPost',
    html: `<p>Clique para entrar no PromoPost:</p><p><a href="${url}">${url}</a></p>`,
  });

  if (error) {
    throw new Error(`Falha ao enviar email de login: ${error.message}`);
  }
}
