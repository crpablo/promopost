'use client';

import { useState, type FormEvent } from 'react';

type Resultado = { ok: true; postId: string } | { ok: false; error: string };

export default function TikTokPostForm() {
  const [imageUrl, setImageUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setEnviando(true);
    setResultado(null);
    try {
      const response = await fetch('/api/tiktok/post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageUrl, title, description }),
      });
      const json = (await response.json()) as Resultado;
      setResultado(json);
    } catch (err) {
      setResultado({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid #e5e5e5' }}>
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>Publicar no TikTok</h2>
      <p style={{ color: '#555', fontSize: 14, marginBottom: 16 }}>
        Sua conta do TikTok precisa estar configurada como <strong>conta privada</strong> (Configurações
        e privacidade → Privacidade) — exigência da TikTok pra apps ainda não auditados.
      </p>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          Título
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            style={{ padding: 8, boxSizing: 'border-box' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          Descrição
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            required
            style={{ padding: 8, boxSizing: 'border-box' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          URL da imagem
          <input
            type="text"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            required
            placeholder="https://..."
            style={{ padding: 8, boxSizing: 'border-box' }}
          />
        </label>
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt="Preview"
            style={{ maxWidth: 240, maxHeight: 240, objectFit: 'contain', border: '1px solid #e5e5e5' }}
          />
        )}
        <button type="submit" disabled={enviando} style={{ padding: 12 }}>
          {enviando ? 'Publicando...' : 'Publicar no TikTok'}
        </button>
        {resultado && (
          <p style={{ color: resultado.ok ? '#0a7c2f' : '#b00020' }}>
            {resultado.ok ? 'Publicado com sucesso!' : `Erro: ${resultado.error}`}
          </p>
        )}
      </form>
    </div>
  );
}
