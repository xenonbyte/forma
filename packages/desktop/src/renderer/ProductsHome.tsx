import { useState, useEffect } from 'react';

interface Product {
  id: string;
  name: string;
  description: string;
}

interface ProductsHomeProps {
  forma: {
    listProducts(): Promise<{ products: Product[] }>;
  };
  onSelect: (id: string) => void;
}

type LoadState = 'loading' | 'ready' | 'error';

export function ProductsHome({ forma, onSelect }: ProductsHomeProps) {
  const [state, setState] = useState<LoadState>('loading');
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    forma
      .listProducts()
      .then(({ products: p }) => {
        setProducts(p);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [forma]);

  if (state === 'loading') {
    return <div>Loading products…</div>;
  }

  if (state === 'error') {
    return <div>Failed to load products</div>;
  }

  if (products.length === 0) {
    return (
      <div>No products found. Run `forma serve` and create a product.</div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px', padding: '16px' }}>
      {products.map((p) => (
        <div
          key={p.id}
          data-product-id={p.id}
          onClick={() => onSelect(p.id)}
          style={{ padding: '16px', border: '1px solid #ccc', borderRadius: '8px', cursor: 'pointer' }}
        >
          <strong>{p.name}</strong>
          <p style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: '8px 0 0' }}>
            {p.description}
          </p>
        </div>
      ))}
    </div>
  );
}
