import TikTokPostForm from './TikTokPostForm';

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token || token !== process.env.ADMIN_TOKEN) {
    return (
      <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px' }}>
        <h1>404</h1>
        <p>Página não encontrada.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px', lineHeight: 1.6 }}>
      <h1>Postar no TikTok (teste manual)</h1>
      <TikTokPostForm token={token} />
    </main>
  );
}
