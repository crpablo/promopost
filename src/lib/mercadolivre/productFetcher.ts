export interface Product {
  title: string;
  price: number;
  imageUrl: string;
}

export async function fetchProduct(itemId: string): Promise<Product> {
  const res = await fetch(`https://api.mercadolibre.com/items/${itemId}`);
  if (!res.ok) {
    throw new Error(`Mercado Livre item lookup failed: ${res.status}`);
  }
  const data = await res.json();
  const imageUrl = data.pictures?.[0]?.secure_url || data.thumbnail;
  return {
    title: data.title,
    price: data.price,
    imageUrl,
  };
}
