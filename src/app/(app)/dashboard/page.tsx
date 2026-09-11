import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getPool } from '@/lib/db/pool';
import { getBusinessForUser } from '@/lib/db/businesses';
import { getTikTokAccountForBusiness } from '@/lib/db/tiktokAccounts';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tiktok_error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const business = await getBusinessForUser(getPool(), session.user.id);
  if (!business) {
    redirect('/onboarding');
  }

  const tiktokAccount = await getTikTokAccountForBusiness(getPool(), business.id);
  const { tiktok_error } = await searchParams;

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px', lineHeight: 1.6 }}>
      <h1>Bem-vindo, {business.name}</h1>
      {tiktok_error && (
        <p style={{ color: '#b00020', marginBottom: 12 }}>
          Não foi possível conectar sua conta do TikTok. Tente novamente em alguns instantes.
        </p>
      )}
      {tiktokAccount ? (
        <>
          <p>TikTok conectado ✅</p>
          <a href="/api/tiktok/connect" style={{ display: 'inline-block', padding: 12 }}>
            Reconectar
          </a>
        </>
      ) : (
        <a href="/api/tiktok/connect" style={{ display: 'inline-block', padding: 12 }}>
          Conectar TikTok
        </a>
      )}
    </main>
  );
}
