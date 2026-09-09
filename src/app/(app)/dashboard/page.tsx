import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getPool } from '@/lib/db/pool';
import { getBusinessForUser } from '@/lib/db/businesses';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const business = await getBusinessForUser(getPool(), session.user.id);
  if (!business) {
    redirect('/onboarding');
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px', lineHeight: 1.6 }}>
      <h1>Bem-vindo, {business.name}</h1>
      <p>Em breve: conectar sua conta do TikTok.</p>
      <button disabled style={{ padding: 12, opacity: 0.5 }}>
        Conectar TikTok (em breve)
      </button>
    </main>
  );
}
