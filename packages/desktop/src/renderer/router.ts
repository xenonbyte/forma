/**
 * Hash router for the unified-workspace desktop shell.
 *
 * Supported hashes:
 *   #/products/:pid/requirements/:reqId            -> requirement selection
 *   #/products/:pid/requirements/:reqId/pages/:id  -> page selection
 *
 * parseHash is a pure function (DOM-free, unit-testable). buildHash is its
 * inverse for navigation.
 */

export type Selection =
  | { type: 'none' }
  | { type: 'requirement'; productId: string; reqId: string }
  | { type: 'page'; productId: string; reqId: string; pageId: string };

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Parse a location hash (e.g. `#/products/p/requirements/r`) into a Selection. */
export function parseHash(hash: string): Selection {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const path = raw.replace(/^\/+/, '').replace(/\/+$/, '');
  if (path === '') return { type: 'none' };

  const parts = path.split('/').map(decode);

  if (parts[0] === 'products' && parts[2] === 'requirements') {
    const productId = parts[1];
    const reqId = parts[3];
    if (!productId || !reqId) return { type: 'none' };

    if (parts.length === 4) {
      return { type: 'requirement', productId, reqId };
    }
    if (parts.length === 6 && parts[4] === 'pages' && parts[5]) {
      return { type: 'page', productId, reqId, pageId: parts[5] };
    }
  }

  return { type: 'none' };
}

/** Inverse of parseHash: build a location hash for a Selection. */
export function buildHash(selection: Selection): string {
  const enc = encodeURIComponent;
  switch (selection.type) {
    case 'requirement':
      return `#/products/${enc(selection.productId)}/requirements/${enc(selection.reqId)}`;
    case 'page':
      return `#/products/${enc(selection.productId)}/requirements/${enc(selection.reqId)}/pages/${enc(selection.pageId)}`;
    case 'none':
      return '#/';
  }
}
