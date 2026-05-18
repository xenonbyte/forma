import { LocaleProvider } from "./LocaleContext.js";
import { Layout, type NavItem } from "./components/Layout.js";
import { useCurrentRoute } from "./routes.js";

const navItems: NavItem[] = [
  {
    href: "/products",
    label: "Products",
    meta: "Sessions and requirements"
  },
  {
    href: "/styles",
    label: "Styles",
    meta: "Design libraries"
  }
];

export function App() {
  const match = useCurrentRoute();
  const Page = match.route.component;

  return (
    <LocaleProvider>
      <Layout
        currentPathname={match.pathname}
        navItems={navItems}
        routeContext={match.route.context}
        title={match.route.title(match.params)}
      >
        <Page hash={match.hash} params={match.params} route={match.route} />
      </Layout>
    </LocaleProvider>
  );
}
