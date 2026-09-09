import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getPool } from '@/lib/db/pool';
import { createBusinessForUser, getBusinessForUser } from '@/lib/db/businesses';

export default async function OnboardingPage() {
  const session = await auth();
  if (session?.user?.id) {
    const existingBusiness = await getBusinessForUser(getPool(), session.user.id);
    if (existingBusiness) {
      redirect('/dashboard');
    }
  }

  async function createBusiness(formData: FormData) {
    'use server';
    const name = formData.get('name');
    if (typeof name !== 'string' || !name.trim()) return;

    const session = await auth();
    if (!session?.user?.id) return;

    try {
      await createBusinessForUser(getPool(), session.user.id, name.trim());
    } catch {
      // Duas abas submetendo ao mesmo tempo podem ambas passar da checagem
      // no topo da página e ambas chamarem createBusinessForUser — a perdedora
      // esbarra na constraint unique de owner_user_id. Nesse caso a empresa já
      // foi criada pela outra aba, então /dashboard já mostra o resultado certo.
    }
    redirect('/dashboard');
  }

  return (
    <main style={{ maxWidth: 400, margin: '0 auto', padding: '48px 24px', lineHeight: 1.6 }}>
      <h1>Qual o nome da sua empresa?</h1>
      <form action={createBusiness} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          type="text"
          name="name"
          placeholder="Nome da empresa"
          required
          style={{ padding: 8, boxSizing: 'border-box' }}
        />
        <button type="submit" style={{ padding: 12 }}>
          Continuar
        </button>
      </form>
    </main>
  );
}
