import { useEffect, useMemo, useState, type ReactNode } from "react";

import { apiClient } from "./api.js";
import { PrimaryActionLink, StatePanel } from "./components/Layout.js";
import { BaselineView } from "./pages/BaselineView.js";
import { ProductDetail, type ProductDeleteNavigationState } from "./pages/ProductDetail.js";
import { ProductList } from "./pages/ProductList.js";
import { ProductNew } from "./pages/ProductNew.js";
import { DesignView } from "./pages/DesignView.js";
import { ViewerPage } from "./pages/ViewerPage.js";
import { RequirementDetail } from "./pages/RequirementDetail.js";
import { Settings } from "./pages/Settings.js";
import { AnnotationPage } from "./pages/AnnotationPage.js";
import { StyleDetail } from "./pages/StyleDetail.js";
import { StyleLibrary } from "./pages/StyleLibrary.js";

export interface RoutePageProps {
  hash: string;
  navigationState?: unknown;
  onBreadcrumbLabel?: (key: string, label: string) => void;
  params: Record<string, string>;
  route: RouteDefinition;
}

export interface RouteDefinition {
  component: (props: RoutePageProps) => ReactNode;
  context: string;
  navGroup: "products" | "settings" | "styles";
  path: string;
  title: (params: Record<string, string>) => string;
}

export interface RouteMatch {
  found: boolean;
  hash: string;
  navigationState?: unknown;
  params: Record<string, string>;
  pathname: string;
  route: RouteDefinition;
}

const navigationEvent = "forma:navigation";

interface BrowserLocationSnapshot {
  navigationState?: unknown;
  pathname: string;
}

export const routeTable: RouteDefinition[] = [
  {
    component: ProductListRoute,
    context: "Products",
    navGroup: "products",
    path: "/products",
    title: () => "Products"
  },
  {
    component: ProductNewRoute,
    context: "Products",
    navGroup: "products",
    path: "/products/new",
    title: () => "New product"
  },
  {
    component: ProductDetailRoute,
    context: "Product",
    navGroup: "products",
    path: "/products/:productId",
    title: ({ productId }) => productId
  },
  {
    component: BaselineView,
    context: "Baseline",
    navGroup: "products",
    path: "/products/:productId/baseline",
    title: ({ productId }) => `${productId} baseline`
  },
  {
    component: DesignViewRoute,
    context: "Design",
    navGroup: "products",
    path: "/products/:productId/requirements/:reqId/design",
    title: ({ reqId }) => `${reqId} design`
  },
  {
    component: RequirementViewerRoute,
    context: "Design",
    navGroup: "products",
    path: "/products/:productId/requirements/:reqId/viewer",
    title: ({ reqId }) => `${reqId} 画布`
  },
  {
    component: PageViewerRoute,
    context: "Design",
    navGroup: "products",
    path: "/products/:productId/requirements/:reqId/pages/:pageId/viewer",
    title: ({ pageId }) => `${pageId} 画布`
  },
  {
    component: AnnotationPageRoute,
    context: "Annotation",
    navGroup: "products",
    path: "/products/:productId/requirements/:reqId/annotation",
    title: ({ reqId }) => `${reqId} annotation`
  },
  {
    component: RequirementDetail,
    context: "Requirement",
    navGroup: "products",
    path: "/products/:productId/requirements/:reqId",
    title: ({ reqId }) => reqId
  },
  {
    component: StyleLibraryRoute,
    context: "Styles",
    navGroup: "styles",
    path: "/styles",
    title: () => "Styles"
  },
  {
    component: StyleDetail,
    context: "Style",
    navGroup: "styles",
    path: "/styles/:name",
    title: ({ name }) => name
  },
  {
    component: SettingsRoute,
    context: "Settings",
    navGroup: "settings",
    path: "/settings",
    title: () => "Settings"
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
  const [location, setLocation] = useState(() => readCurrentLocation());

  useEffect(() => {
    if (!canUseDom()) {
      return undefined;
    }

    const updateLocation = () => setLocation(readCurrentLocation());
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
      updateLocation();
    };

    window.addEventListener("popstate", updateLocation);
    window.addEventListener(navigationEvent, updateLocation);
    document.addEventListener("click", handleAnchorClick);

    return () => {
      window.removeEventListener("popstate", updateLocation);
      window.removeEventListener(navigationEvent, updateLocation);
      document.removeEventListener("click", handleAnchorClick);
    };
  }, []);

  return useMemo(() => {
    const match = matchRoute(location.pathname);
    return { ...match, navigationState: location.navigationState };
  }, [location]);
}

export function navigateTo(pathname: string, navigationState?: unknown) {
  if (!canUseDom()) {
    return;
  }

  const url = new URL(pathname, window.location.href);
  window.history.pushState(navigationState ?? {}, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new Event(navigationEvent));
}

export function matchRoute(rawPathname: string, routes: RouteDefinition[] = routeTable): RouteMatch {
  const hash = extractHash(rawPathname);
  const pathname = normalizePathname(rawPathname);
  const pathnameToMatch = pathname === "/" ? "/products" : pathname;

  for (const route of routes) {
    const params = matchPath(route.path, pathnameToMatch);
    if (params) {
      return { found: true, hash, navigationState: undefined, params, pathname: pathnameToMatch, route };
    }
  }

  return { found: false, hash, navigationState: undefined, params: {}, pathname, route: notFoundRoute };
}

function AnnotationPageRoute(props: RoutePageProps) {
  return <AnnotationPage client={apiClient} params={props.params as { productId: string; reqId: string }} />;
}

function DesignViewRoute(props: RoutePageProps) {
  return <DesignView client={apiClient} params={props.params} />;
}

function RequirementViewerRoute(props: RoutePageProps) {
  return <ViewerPage client={apiClient} params={props.params as { productId: string; reqId: string }} entry="requirement" />;
}

function PageViewerRoute(props: RoutePageProps) {
  return <ViewerPage client={apiClient} params={props.params as { productId: string; reqId: string; pageId: string }} entry="page" />;
}

function ProductListRoute(props: RoutePageProps) {
  return <ProductList {...props} />;
}

function ProductNewRoute() {
  return <ProductNew navigate={navigateTo} />;
}

function ProductDetailRoute(props: RoutePageProps) {
  return (
    <ProductDetail
      {...props}
      onNavigate={(pathname: string, deleteState?: ProductDeleteNavigationState) => {
        navigateTo(pathname, deleteState ? { productDelete: deleteState } : undefined);
      }}
    />
  );
}

function StyleLibraryRoute() {
  return <StyleLibrary />;
}

function SettingsRoute() {
  return <Settings />;
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

function readCurrentLocation(): BrowserLocationSnapshot {
  return canUseDom()
    ? {
        navigationState: window.history.state,
        pathname: `${window.location.pathname}${window.location.search}${window.location.hash}`
      }
    : { pathname: "/products" };
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

function extractHash(rawPathname: string): string {
  const hashIndex = rawPathname.indexOf("#");
  return hashIndex >= 0 ? rawPathname.slice(hashIndex) : "";
}
