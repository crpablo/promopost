export interface Product {
  title: string;
  price: number;
  imageUrl: string;
}

export async function fetchProduct(itemId: string): Promise<Product> {
  const res = await fetch(`https://api.mercadolibre.com/items/${itemId}`);
  if (!res.ok) {
    throw new Error(`Falha ao buscar produto no Mercado Livre: ${res.status}`);
  }
  const data = await res.json();
  const imageUrl = data.pictures?.[0]?.secure_url || data.thumbnail;
  if (typeof data.title !== 'string' || typeof data.price !== 'number' || typeof imageUrl !== 'string') {
    throw new Error('Resposta inesperada da API do Mercado Livre: dados do produto incompletos');
  }
  return {
    title: data.title,
    price: data.price,
    imageUrl,
  };
}
