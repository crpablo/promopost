import { signIn } from '@/auth';

export default function LoginPage() {
  async function login(formData: FormData) {
    'use server';
    const email = formData.get('email');
    if (typeof email !== 'string' || !email.trim()) return;
    await signIn('nodemailer', { email, redirectTo: '/dashboard' });
  }

  return (
    <main style={{ maxWidth: 400, margin: '0 auto', padding: '48px 24px', lineHeight: 1.6 }}>
      <h1>Entrar no PromoPost</h1>
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
