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
