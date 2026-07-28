export async function loadSession(): Promise<string> {
  const url = process.env.TELEGRAM_SESSION_BLOB_URL;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!url) {
    throw new Error('TELEGRAM_SESSION_BLOB_URL não configurada');
  }
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Falha ao carregar sessão do Telegram: ${res.status}`);
  }
  const text = await res.text();
  return text.trim();
}
