import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "./Sidebar.js";
import { TopBar } from "./TopBar.js";
import { WorkspacePane, type WorkspaceSelection } from "./WorkspacePane.js";
import { parseHash, buildHash, type Selection } from "./router.js";

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

interface PageState {
  reqId: string | null;
  pages: PageRow[];
}

function toWorkspaceSelection(sel: Selection): { productId: string | null; nav: WorkspaceSelection } {
  switch (sel.type) {
    case "requirement":
      return { productId: sel.productId, nav: { type: "requirement", reqId: sel.reqId } };
    case "page":
      return { productId: sel.productId, nav: { type: "page", reqId: sel.reqId, pageId: sel.pageId } };
    case "none":
      return { productId: null, nav: { type: "none" } };
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
  const [pageState, setPageState] = useState<PageState>({ reqId: null, pages: [] });
  const [baseUrl, setBaseUrl] = useState<string>("");
  const [connected, setConnected] = useState<boolean>(true);
  const [startupReady, setStartupReady] = useState<boolean>(false);
  const [nav, setNav] = useState<WorkspaceSelection>({ type: "none" });
  const activeReqId = nav.type === "requirement" || nav.type === "page" ? nav.reqId : null;
  const pages = pageState.reqId === activeReqId ? pageState.pages : [];

  // --- Startup: products, baseUrl, brand styles, default selection --------
  useEffect(() => {
    const forma = window.forma;
    if (!forma) {
      setConnected(false);
      setStartupReady(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [{ products: ps }, base] = await Promise.all([forma.listProducts(), forma.formaServerBaseUrl()]);
        if (cancelled) return;
        setProducts(ps);
        setBaseUrl(base);

        const hashSel = parseHash(window.location.hash);
        const fromHash = toWorkspaceSelection(hashSel);
        const hashProductExists =
          (hashSel.type === "requirement" || hashSel.type === "page") && ps.some((p) => p.id === hashSel.productId);
        const productId = hashProductExists ? hashSel.productId : (ps[0]?.id ?? null);
        setActiveProductId(productId);
        if (hashProductExists) {
          setNav(fromHash.nav);
        }
        setStartupReady(true);
      } catch {
        if (!cancelled) {
          setConnected(false);
          setStartupReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Runtime deep links: keep Back/Forward and hash edits in state -------
  useEffect(() => {
    if (products.length === 0) return;

    const handleHashChange = () => {
      const hashSel = parseHash(window.location.hash);
      const fromHash = toWorkspaceSelection(hashSel);

      if (hashSel.type === "requirement" || hashSel.type === "page") {
        if (!products.some((p) => p.id === hashSel.productId)) return;
        setActiveProductId(hashSel.productId);
        setNav(fromHash.nav);
        return;
      }

      setActiveProductId((current) => current ?? products[0]?.id ?? null);
      setNav({ type: "none" });
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, [products]);

  // --- Per-product: requirements; default a requirement if none chosen ----
  useEffect(() => {
    const forma = window.forma;
    if (!forma || !activeProductId) {
      setRequirements([]);
      setPageState({ reqId: null, pages: [] });
      return;
    }
    let cancelled = false;
    setRequirements([]);
    setPageState({ reqId: null, pages: [] });
    void (async () => {
      try {
        const { requirements: rs } = await forma.listRequirements(activeProductId);
        if (cancelled) return;
        setRequirements(rs);

        setNav((current) => {
          if ((current.type === "requirement" || current.type === "page") && rs.some((r) => r.id === current.reqId)) {
            return current;
          }
          return rs[0] ? { type: "requirement", reqId: rs[0].id } : { type: "none" };
        });
      } catch {
        if (!cancelled) {
          setRequirements([]);
          setPageState({ reqId: null, pages: [] });
          setConnected(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProductId]);

  // --- Per-requirement: full pages from getRequirement --------------------
  useEffect(() => {
    const forma = window.forma;
    if (!forma || !activeProductId || !activeReqId) {
      setPageState({ reqId: null, pages: [] });
      return;
    }
    let cancelled = false;
    setPageState({ reqId: activeReqId, pages: [] });
    void (async () => {
      try {
        const requirement = await forma.getRequirement(activeProductId, activeReqId);
        if (cancelled) return;
        const nextPages = (requirement.pages ?? []).map((p) => ({ page_id: p.page_id, name: p.name }));
        setPageState({ reqId: activeReqId, pages: nextPages });
        setNav((current) => {
          if (current.type !== "page" || current.reqId !== activeReqId) return current;
          return nextPages.some((p) => p.page_id === current.pageId)
            ? current
            : { type: "requirement", reqId: activeReqId };
        });
      } catch {
        if (!cancelled) setPageState({ reqId: activeReqId, pages: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProductId, activeReqId]);

  // --- Keep the location hash in sync with the current selection ----------
  useEffect(() => {
    if (!startupReady) return;
    let sel: Selection;
    if (nav.type === "none") {
      sel = { type: "none" };
    } else if (activeProductId) {
      sel =
        nav.type === "page"
          ? { type: "page", productId: activeProductId, reqId: nav.reqId, pageId: nav.pageId }
          : { type: "requirement", productId: activeProductId, reqId: nav.reqId };
    } else {
      return;
    }
    const next = buildHash(sel);
    const current = window.location.hash || buildHash({ type: "none" });
    if (current !== next) {
      window.location.hash = next;
    }
  }, [nav, activeProductId, startupReady]);

  const handleSelectProduct = useCallback((productId: string) => {
    setActiveProductId(productId);
    setNav({ type: "none" });
    setRequirements([]);
    setPageState({ reqId: null, pages: [] });
  }, []);

  const activeProduct = products.find((p) => p.id === activeProductId) ?? null;
  const productName = activeProduct?.name ?? "";

  const crumb = (() => {
    const req = requirements.find((r) => r.id === activeReqId);
    if (!req) return "";
    if (nav.type === "page") {
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
        connected={connected}
        nav={nav}
        onSelect={setNav}
        onSelectProduct={handleSelectProduct}
      />
      <TopBar productName={productName} crumb={crumb} />
      <WorkspacePane selection={nav} productId={activeProductId ?? ""} baseUrl={baseUrl} />
    </div>
  );
}
