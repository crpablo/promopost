import { notFound } from 'next/navigation';
import TikTokPostForm from './TikTokPostForm';

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token || token !== process.env.ADMIN_TOKEN) {
    notFound();
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px', lineHeight: 1.6 }}>
      <h1>Postar no TikTok (teste manual)</h1>
      <TikTokPostForm token={token} />
    </main>
  );
}
