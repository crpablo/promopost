'use client';

import { useState, type FormEvent } from 'react';

const EXEMPLO_IMAGEM =
  'https://http2.mlstatic.com/D_NQ_NP_2X_856819-MLA45678901234_012026-F.webp';

type Resultado = { ok: true; postId: string } | { ok: false; error: string };

export default function TikTokPostForm({ token }: { token: string }) {
  const [imageUrl, setImageUrl] = useState(EXEMPLO_IMAGEM);
  const [title, setTitle] = useState('Produto em promoção');
  const [description, setDescription] = useState('Confira essa oferta na Tobie Store!');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setEnviando(true);
    setResultado(null);
    try {
      const response = await fetch('/api/admin/tiktok-post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, imageUrl, title, description }),
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
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label>
        URL da imagem
        <input
          type="text"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
        />
      </label>
      <label>
        Título
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
        />
      </label>
      <label>
        Descrição
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
        />
      </label>
      <button type="submit" disabled={enviando} style={{ padding: 12 }}>
        {enviando ? 'Publicando...' : 'Publicar no TikTok'}
      </button>
      {resultado && (
        <p style={{ color: resultado.ok ? 'green' : 'crimson' }}>
          {resultado.ok ? `Publicado! postId: ${resultado.postId}` : `Erro: ${resultado.error}`}
        </p>
      )}
    </form>
  );
}
