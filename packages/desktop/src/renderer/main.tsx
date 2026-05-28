// Forma desktop renderer entry — implemented in D2-05
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<div>Loading Forma…</div>);
}
