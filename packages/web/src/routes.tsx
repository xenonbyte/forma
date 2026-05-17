import { useEffect, useMemo, useState, type ReactNode } from "react";

import { PrimaryActionLink, StatePanel, WorkSurface } from "./components/Layout.js";

export interface RoutePageProps {
  params: Record<string, string>;
  route: RouteDefinition;
}

export interface RouteDefinition {
  component: (props: RoutePageProps) => ReactNode;
  context: string;
  navGroup: "products" | "styles";
  path: string;
  title: (params: Record<string, string>) => string;
}

export interface RouteMatch {
  found: boolean;
  params: Record<string, string>;
  pathname: string;
  route: RouteDefinition;
}

const navigationEvent = "forma:navigation";

export const routeTable: RouteDefinition[] = [
  {
    component: ProductsPage,
    context: "Products",
    navGroup: "products",
    path: "/products",
    title: () => "Products"
  },
  {
    component: ProductNewPage,
    context: "Products",
    navGroup: "products",
    path: "/products/new",
    title: () => "New product"
  },
  {
    component: ProductDetailPage,
    context: "Product",
    navGroup: "products",
    path: "/products/:productId",
    title: ({ productId }) => productId
  },
  {
    component: BaselinePage,
    context: "Baseline",
    navGroup: "products",
    path: "/products/:productId/baseline",
    title: ({ productId }) => `${productId} baseline`
  },
  {
    component: RequirementPage,
    context: "Requirement",
    navGroup: "products",
    path: "/products/:productId/requirements/:reqId",
    title: ({ reqId }) => reqId
  },
  {
    component: DesignPage,
    context: "Design",
    navGroup: "products",
    path: "/products/:productId/requirements/:reqId/designs/:designId",
    title: ({ designId }) => designId
  },
  {
    component: StylesPage,
    context: "Styles",
    navGroup: "styles",
    path: "/styles",
    title: () => "Styles"
  },
  {
    component: StyleDetailPage,
    context: "Style",
    navGroup: "styles",
    path: "/styles/:name",
    title: ({ name }) => name
  }
];

export const notFoundRoute: RouteDefinition = {
  component: NotFoundPage,
  context: "Route",
  navGroup: "products",
  path: "*",
  title: () => "Not found"
};

export function useCurrentRoute(): RouteMatch {
  const [pathname, setPathname] = useState(() => readCurrentPathname());

  useEffect(() => {
    if (!canUseDom()) {
      return undefined;
    }

    const updatePathname = () => setPathname(readCurrentPathname());
    const handleAnchorClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target || anchor.hasAttribute("download")) {
        return;
      }

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || !matchRoute(url.pathname).found) {
        return;
      }

      event.preventDefault();
      window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
      updatePathname();
    };

    window.addEventListener("popstate", updatePathname);
    window.addEventListener(navigationEvent, updatePathname);
    document.addEventListener("click", handleAnchorClick);

    return () => {
      window.removeEventListener("popstate", updatePathname);
      window.removeEventListener(navigationEvent, updatePathname);
      document.removeEventListener("click", handleAnchorClick);
    };
  }, []);

  return useMemo(() => matchRoute(pathname), [pathname]);
}

export function navigateTo(pathname: string) {
  if (!canUseDom()) {
    return;
  }

  const url = new URL(pathname, window.location.href);
  window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new Event(navigationEvent));
}

export function matchRoute(rawPathname: string, routes: RouteDefinition[] = routeTable): RouteMatch {
  const pathname = normalizePathname(rawPathname);
  const pathnameToMatch = pathname === "/" ? "/products" : pathname;

  for (const route of routes) {
    const params = matchPath(route.path, pathnameToMatch);
    if (params) {
      return { found: true, params, pathname: pathnameToMatch, route };
    }
  }

  return { found: false, params: {}, pathname, route: notFoundRoute };
}

function ProductsPage() {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 lg:grid-cols-3">
        <StatePanel state="empty" title="Product index">
          No product records are loaded in this shell yet.
        </StatePanel>
        <StatePanel state="loading" title="Requirement status">
          Product status request is loading.
        </StatePanel>
        <StatePanel state="error" title="API response">
          PRODUCT_NOT_FOUND · Product not found.
        </StatePanel>
      </div>

      <WorkSurface title="Product queue">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-zinc-600">Create a product or select one once product data is available.</p>
          <PrimaryActionLink href="/products/new">New product</PrimaryActionLink>
        </div>
      </WorkSurface>
    </div>
  );
}

function ProductNewPage() {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <WorkSurface title="Product details">
        <div className="grid gap-4">
          {["Name", "Description", "Platform", "Style"].map((label) => (
            <label className="grid gap-1 text-sm font-medium text-zinc-700" key={label}>
              {label}
              <input
                className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500"
                disabled
                placeholder="Not loaded"
              />
            </label>
          ))}
        </div>
      </WorkSurface>
      <StatePanel state="empty" title="Submission">
        Required fields are empty. Save remains unavailable.
      </StatePanel>
    </div>
  );
}

function ProductDetailPage({ params }: RoutePageProps) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 lg:grid-cols-3">
        <StatePanel state="empty" title="Baseline">No baseline summary loaded for {params.productId}.</StatePanel>
        <StatePanel state="empty" title="Requirements">No active requirements loaded.</StatePanel>
        <StatePanel state="loading" title="Archive state">Archive controls wait for product data.</StatePanel>
      </div>

      <WorkSurface title="Product workspace">
        <div className="grid gap-3 md:grid-cols-2">
          <a className={secondaryLinkClasses} href={`/products/${params.productId}/baseline`}>
            Baseline
          </a>
          <a className={secondaryLinkClasses} href={`/products/${params.productId}/requirements/R-draft`}>
            Requirement draft
          </a>
        </div>
      </WorkSurface>
    </div>
  );
}

function BaselinePage({ params }: RoutePageProps) {
  return (
    <div className="space-y-5">
      <StatePanel state="loading" title="Functional pages">
        Baseline pages for {params.productId} are loading.
      </StatePanel>
      <WorkSurface title="Navigation list">
        <PlaceholderRows labels={["Page", "Source requirement", "Last design"]} />
      </WorkSurface>
    </div>
  );
}

function RequirementPage({ params }: RoutePageProps) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <WorkSurface title="Requirement document">
        <p className="text-sm leading-6 text-zinc-600">Document preview for {params.reqId} is not loaded.</p>
      </WorkSurface>
      <div className="space-y-3">
        <StatePanel state="empty" title="Pages">No generated pages are available.</StatePanel>
        <StatePanel state="error" title="Design history">No design history response is available.</StatePanel>
      </div>
    </div>
  );
}

function DesignPage({ params }: RoutePageProps) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <WorkSurface title="Annotation canvas">
        <div className="flex aspect-[16/9] items-center justify-center rounded-md border border-dashed border-zinc-300 bg-zinc-50 text-sm font-medium text-zinc-500">
          {params.designId}
        </div>
      </WorkSurface>
      <WorkSurface title="Properties">
        <PlaceholderRows labels={["Selected node", "Dimensions", "Spacing", "Asset export"]} />
      </WorkSurface>
    </div>
  );
}

function StylesPage() {
  return (
    <div className="space-y-5">
      <StatePanel state="empty" title="Style library">
        Installed styles will appear as searchable rows.
      </StatePanel>
      <WorkSurface title="Style grid">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {["Modern SaaS", "Mobile Retail", "Analytics"].map((name) => (
            <a className={secondaryLinkClasses} href={`/styles/${encodeURIComponent(name)}`} key={name}>
              {name}
            </a>
          ))}
        </div>
      </WorkSurface>
    </div>
  );
}

function StyleDetailPage({ params }: RoutePageProps) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <WorkSurface title="Style preview">
        <div className="aspect-[4/3] rounded-md border border-dashed border-zinc-300 bg-zinc-50" />
      </WorkSurface>
      <StatePanel state="loading" title="Variables">
        Style variables for {params.name} are loading.
      </StatePanel>
    </div>
  );
}

function NotFoundPage() {
  return (
    <StatePanel
      action={<PrimaryActionLink href="/products">Products</PrimaryActionLink>}
      state="error"
      title="Route not found"
    >
      Route is outside the Forma admin table.
    </StatePanel>
  );
}

function PlaceholderRows({ labels }: { labels: string[] }) {
  return (
    <div className="divide-y divide-zinc-200">
      {labels.map((label) => (
        <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm" key={label}>
          <span className="font-medium text-zinc-700">{label}</span>
          <span className="text-zinc-500">Empty</span>
        </div>
      ))}
    </div>
  );
}

function matchPath(routePath: string, pathname: string): Record<string, string> | undefined {
  const routeSegments = routePath.split("/").filter(Boolean);
  const pathSegments = pathname.split("/").filter(Boolean);
  const params: Record<string, string> = {};

  if (routeSegments.length !== pathSegments.length) {
    return undefined;
  }

  for (const [index, routeSegment] of routeSegments.entries()) {
    const pathSegment = pathSegments[index];
    if (routeSegment.startsWith(":")) {
      params[routeSegment.slice(1)] = safeDecode(pathSegment);
    } else if (routeSegment !== pathSegment) {
      return undefined;
    }
  }

  return params;
}

function normalizePathname(rawPathname: string): string {
  const [pathname = "/"] = rawPathname.split(/[?#]/);
  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, "") : withLeadingSlash;
}

function readCurrentPathname(): string {
  return canUseDom() ? window.location.pathname : "/products";
}

function canUseDom(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const secondaryLinkClasses =
  "rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-zinc-950 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";
