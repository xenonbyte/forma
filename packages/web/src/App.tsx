import { useCallback, useState } from "react";

import { LocaleProvider, useT } from "./LocaleContext.js";
import { Layout, PrimaryActionLink, type BreadcrumbItem, type NavItem } from "./components/Layout.js";
import { useCurrentRoute, type RouteMatch } from "./routes.js";

const navItems: NavItem[] = [
  {
    href: "/products",
    label: "Product list",
    meta: "Sessions and requirements"
  },
  {
    href: "/styles",
    label: "Style templates",
    meta: "Design libraries"
  },
  {
    href: "/settings",
    label: "Settings",
    meta: "Preferences"
  }
];

export function App() {
  const match = useCurrentRoute();

  return (
    <LocaleProvider>
      <AppShell match={match} />
    </LocaleProvider>
  );
}

function AppShell({ match }: { match: RouteMatch }) {
  const Page = match.route.component;
  const t = useT();
  const [breadcrumbLabels, setBreadcrumbLabels] = useState<Record<string, string>>({});
  const onBreadcrumbLabel = useCallback((key: string, label: string) => {
    setBreadcrumbLabels((current) => (current[key] === label ? current : { ...current, [key]: label }));
  }, []);
  const headerAction =
    match.route.path === "/products" ? <PrimaryActionLink href="/products/new">{t("action.newProduct")}</PrimaryActionLink> : undefined;
  const breadcrumbs = routeBreadcrumbs(match, t, breadcrumbLabels);

  return (
    <Layout
      breadcrumbs={breadcrumbs}
      currentPathname={match.pathname}
      headerAction={headerAction}
      navItems={navItems}
      routeContext={match.route.context}
      title={match.route.title(match.params)}
    >
      <Page hash={match.hash} navigationState={match.navigationState} onBreadcrumbLabel={onBreadcrumbLabel} params={match.params} route={match.route} />
    </Layout>
  );
}

function routeBreadcrumbs(match: RouteMatch, t: (key: string) => string, labels: Record<string, string>): BreadcrumbItem[] {
  const productId = match.params.productId;
  const requirementId = match.params.reqId;
  const productName = productId ? labels[`product:${productId}`] ?? productId : "";
  const requirementName = requirementId ? labels[`requirement:${requirementId}`] ?? requirementId : "";
  const productsRoot: BreadcrumbItem = { href: "/products", label: t("nav.products") };
  const stylesRoot: BreadcrumbItem = { href: "/styles", label: t("nav.styles") };

  if (match.route.path === "/products") {
    return [{ label: t("nav.products") }];
  }
  if (match.route.path === "/products/new") {
    return [productsRoot, { label: t("action.newProduct") }];
  }
  if (productId && match.route.path === "/products/:productId") {
    return [productsRoot, { label: productName }];
  }
  if (productId && match.route.path === "/products/:productId/baseline") {
    return [productsRoot, { href: `/products/${encodeURIComponent(productId)}`, label: productName }, { label: t("requirement.baseline") }];
  }
  if (productId && requirementId && match.route.path === "/products/:productId/requirements/:reqId") {
    return [productsRoot, { href: `/products/${encodeURIComponent(productId)}`, label: productName }, { label: requirementName }];
  }
  if (productId && requirementId && match.route.path.includes("/requirements/:reqId/")) {
    return [
      productsRoot,
      { href: `/products/${encodeURIComponent(productId)}`, label: productName },
      { href: `/products/${encodeURIComponent(productId)}/requirements/${encodeURIComponent(requirementId)}`, label: requirementName },
      { label: t("design.view") }
    ];
  }
  if (match.route.path === "/styles") {
    return [{ label: t("nav.styles") }];
  }
  if (match.route.path === "/styles/:name") {
    return [stylesRoot, { label: t("style.detail.showcase") }];
  }
  if (match.route.path === "/settings") {
    return [{ label: t("nav.settings") }];
  }
  return [{ label: match.route.title(match.params) }];
}
