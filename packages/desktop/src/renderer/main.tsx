import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionGate } from './SessionGate.js';
import { ProductsHome } from './ProductsHome.js';
import { ProductView } from './ProductView.js';
import { ArtifactDetail } from './ArtifactDetail.js';

type AppRoute =
  | { view: 'products' }
  | { view: 'product'; productId: string }
  | { view: 'artifact'; productId: string; artifactId: string };

export function App() {
  const [route, setRoute] = useState<AppRoute>({ view: 'products' });

  // window.forma is guaranteed to be set by the time SessionGate renders children
  // (preload injects it before the renderer loads).
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const forma = window.forma!;

  return (
    <SessionGate>
      {route.view === 'products' && (
        <ProductsHome
          forma={forma}
          onSelect={(id) => setRoute({ view: 'product', productId: id })}
        />
      )}
      {route.view === 'product' && (
        <ProductView
          forma={forma}
          productId={route.productId}
          onBack={() => setRoute({ view: 'products' })}
          onSelectArtifact={(artifactId) => setRoute({ view: 'artifact', productId: route.productId, artifactId })}
        />
      )}
      {route.view === 'artifact' && (
        <>
          <ProductView
            forma={forma}
            productId={route.productId}
            onBack={() => setRoute({ view: 'products' })}
            onSelectArtifact={(artifactId) => setRoute({ view: 'artifact', productId: route.productId, artifactId })}
          />
          <ArtifactDetail
            forma={forma}
            productId={route.productId}
            artifactId={route.artifactId}
            onClose={() => setRoute({ view: 'product', productId: route.productId })}
          />
        </>
      )}
    </SessionGate>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
