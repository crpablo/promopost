import { redirect, unstable_rethrow } from 'next/navigation';
import { auth, signIn } from '@/auth';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) {
    redirect('/dashboard');
  }

  const { error } = await searchParams;

  async function login(formData: FormData) {
    'use server';
    const email = formData.get('email');
    if (typeof email !== 'string' || !email.trim()) return;
    try {
      await signIn('nodemailer', { email, redirectTo: '/dashboard' });
    } catch (err) {
      // signIn() redireciona internamente em caso de sucesso lançando um erro
      // especial do Next (NEXT_REDIRECT) — precisa deixar esse "erro" seguir
      // seu caminho normal. unstable_rethrow identifica e relança esses erros
      // de controle de fluxo do framework; só chega abaixo dele uma falha real
      // (ex: Resend fora do ar).
      unstable_rethrow(err);
      redirect('/login?error=1');
    }
  }

  return (
    <main style={{ maxWidth: 400, margin: '0 auto', padding: '48px 24px', lineHeight: 1.6 }}>
      <h1>Entrar no PromoPost</h1>
      {error && (
        <p style={{ color: '#b00020', marginBottom: 12 }}>
          Não foi possível enviar o link de acesso. Tente novamente em alguns instantes.
        </p>
      )}
      <form action={login} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          type="email"
          name="email"
          placeholder="seu@email.com"
          required
          style={{ padding: 8, boxSizing: 'border-box' }}
        />
        <button type="submit" style={{ padding: 12 }}>
          Enviar link de acesso
        </button>
      </form>
    </main>
  );
}
