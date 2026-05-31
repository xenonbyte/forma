import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './Sidebar.js';
import { TopBar } from './TopBar.js';
import { WorkspacePane, type WorkspaceSelection } from './WorkspacePane.js';
import { parseHash, buildHash, type Selection } from './router.js';

interface ProductRow {
  id: string;
  name: string;
  description: string;
  platform?: string;
}

interface RequirementRow {
  id: string;
  title: string;
  status: string;
  ui_affected: boolean;
}

interface PageRow {
  page_id: string;
  name: string;
}

interface BrandStyleRow {
  name: string;
  description: string;
}

function toWorkspaceSelection(sel: Selection): { productId: string | null; nav: WorkspaceSelection } {
  switch (sel.type) {
    case 'requirement':
      return { productId: sel.productId, nav: { type: 'requirement', reqId: sel.reqId } };
    case 'page':
      return { productId: sel.productId, nav: { type: 'page', reqId: sel.reqId, pageId: sel.pageId } };
    case 'style':
      return { productId: null, nav: { type: 'style', name: sel.name } };
    case 'none':
      return { productId: null, nav: { type: 'none' } };
  }
}

/**
 * Orchestrator for the unified-workspace shell. Holds selection state and
 * drives startup data loading via the preload IPC (`window.forma`), all
 * read-only. The leaf components (Sidebar/TopBar/WorkspacePane) are wired
 * from this state. The `formaServerBaseUrl()` is fetched once and passed to
 * WorkspacePane ONLY for the viewer resource resolver.
 */
export function AppShell() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<RequirementRow[]>([]);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [brandStyles, setBrandStyles] = useState<BrandStyleRow[]>([]);
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [connected, setConnected] = useState<boolean>(true);
  const [nav, setNav] = useState<WorkspaceSelection>({ type: 'none' });

  // --- Startup: products, baseUrl, brand styles, default selection --------
  useEffect(() => {
    const forma = window.forma;
    if (!forma) {
      setConnected(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [{ products: ps }, base, styles] = await Promise.all([
          forma.listProducts(),
          forma.formaServerBaseUrl(),
          forma.listStyles(),
        ]);
        if (cancelled) return;
        setProducts(ps);
        setBaseUrl(base);
        setBrandStyles(styles.map((s) => ({ name: s.name, description: s.description })));

        const hashSel = parseHash(window.location.hash);
        const fromHash = toWorkspaceSelection(hashSel);
        const productId =
          fromHash.productId && ps.some((p) => p.id === fromHash.productId)
            ? fromHash.productId
            : (ps[0]?.id ?? null);
        setActiveProductId(productId);
        if (hashSel.type !== 'none') {
          setNav(fromHash.nav);
        }
      } catch {
        if (!cancelled) setConnected(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Per-product: requirements; default a requirement if none chosen ----
  useEffect(() => {
    const forma = window.forma;
    if (!forma || !activeProductId) return;
    let cancelled = false;
    void (async () => {
      try {
        const { requirements: rs } = await forma.listRequirements(activeProductId);
        if (cancelled) return;
        setRequirements(rs);

        setNav((current) => {
          if (current.type === 'style') return current;
          if (
            (current.type === 'requirement' || current.type === 'page') &&
            rs.some((r) => r.id === current.reqId)
          ) {
            return current;
          }
          return rs[0] ? { type: 'requirement', reqId: rs[0].id } : { type: 'none' };
        });
      } catch {
        if (!cancelled) setConnected(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProductId]);

  // --- Per-requirement: full pages from getRequirement --------------------
  const activeReqId = nav.type === 'requirement' || nav.type === 'page' ? nav.reqId : null;
  useEffect(() => {
    const forma = window.forma;
    if (!forma || !activeProductId || !activeReqId) {
      setPages([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const requirement = await forma.getRequirement(activeProductId, activeReqId);
        if (cancelled) return;
        setPages((requirement.pages ?? []).map((p) => ({ page_id: p.page_id, name: p.name })));
      } catch {
        if (!cancelled) setPages([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProductId, activeReqId]);

  // --- Keep the location hash in sync with the current selection ----------
  useEffect(() => {
    if (nav.type === 'none') return;
    let sel: Selection;
    if (nav.type === 'style') {
      sel = { type: 'style', name: nav.name };
    } else if (activeProductId) {
      sel =
        nav.type === 'page'
          ? { type: 'page', productId: activeProductId, reqId: nav.reqId, pageId: nav.pageId }
          : { type: 'requirement', productId: activeProductId, reqId: nav.reqId };
    } else {
      return;
    }
    const next = buildHash(sel);
    if (window.location.hash !== next) {
      window.location.hash = next;
    }
  }, [nav, activeProductId]);

  const handleSelectProduct = useCallback((productId: string) => {
    setActiveProductId(productId);
    setNav({ type: 'none' });
    setPages([]);
  }, []);

  const activeProduct = products.find((p) => p.id === activeProductId) ?? null;
  const productName = activeProduct?.name ?? '';

  const crumb = (() => {
    if (nav.type === 'style') return `品牌风格 / ${nav.name}`;
    const req = requirements.find((r) => r.id === activeReqId);
    if (!req) return '';
    if (nav.type === 'page') {
      const page = pages.find((p) => p.page_id === nav.pageId);
      return `${req.title} / ${page?.name ?? nav.pageId}`;
    }
    return req.title;
  })();

  return (
    <div className="shell">
      <Sidebar
        products={products}
        activeProductId={activeProductId}
        requirements={requirements}
        pages={pages}
        brandStyles={brandStyles}
        connected={connected}
        nav={nav}
        onSelect={setNav}
        onSelectProduct={handleSelectProduct}
      />
      <TopBar productName={productName} crumb={crumb} />
      <WorkspacePane selection={nav} productId={activeProductId ?? ''} baseUrl={baseUrl} />
    </div>
  );
}
