import { put } from '@vercel/blob';

const SESSION_BLOB_PATHNAME = 'ml-session.json';

export async function saveSession(buffer: Buffer): Promise<{ url: string }> {
  const blob = await put(SESSION_BLOB_PATHNAME, buffer, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return { url: blob.url };
}

export async function loadSession(): Promise<Buffer> {
  const url = process.env.ML_SESSION_BLOB_URL;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!url) {
    throw new Error('ML_SESSION_BLOB_URL não configurada');
  }
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Falha ao carregar sessão do Blob: ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
