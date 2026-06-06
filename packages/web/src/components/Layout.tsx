import { useState, type JSX, type ReactNode } from "react";

import { useT } from "../LocaleContext.js";

export interface NavItem {
  href: string;
  label: string;
  meta: string;
}

export interface BreadcrumbItem {
  href?: string;
  label: string;
}

export interface LayoutProps {
  breadcrumbs?: BreadcrumbItem[];
  children: ReactNode;
  currentPathname: string;
  headerAction?: ReactNode;
  navItems: NavItem[];
  routeContext: string;
  title: string;
}

export interface StatePanelProps {
  action?: ReactNode;
  children: ReactNode;
  state: "empty" | "error" | "loading";
  title: string;
}

const focusClasses =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";

export function Layout({ breadcrumbs, children, currentPathname, headerAction, navItems, title }: LayoutProps) {
  const tx = useT();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const headerBreadcrumbs = breadcrumbs && breadcrumbs.length > 0 ? breadcrumbs : [{ label: routeLabel(title, tx) }];

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-zinc-950">
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside
          className={`w-full shrink-0 bg-[#f1f3f5] transition-[width] duration-200 ${
            sidebarCollapsed ? "md:w-[76px]" : "md:w-56"
          }`}
          data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
        >
          <div
            className={`flex min-h-16 items-center py-3 ${sidebarCollapsed ? "px-4 md:justify-center md:px-0" : "justify-between gap-3 px-7"}`}
          >
            <div className={`min-w-0 ${sidebarCollapsed ? "md:hidden" : ""}`}>
              <a
                className={`inline-flex rounded-md text-[21px] font-bold leading-none tracking-normal text-zinc-950 active:scale-95 ${focusClasses}`}
                href="/products"
              >
                Forma
              </a>
            </div>
            <button
              aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? tx("nav.expandSidebar") : tx("nav.collapseSidebar")}
              className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-transparent text-zinc-700 transition hover:bg-zinc-200/80 hover:text-zinc-950 active:scale-95 ${focusClasses}`}
              data-sidebar-toggle="true"
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
              title={sidebarCollapsed ? tx("nav.expandSidebar") : tx("nav.collapseSidebar")}
              type="button"
            >
              {sidebarToggleIcon(sidebarCollapsed)}
            </button>
          </div>

          <nav
            aria-label="Primary"
            className={`flex gap-3 overflow-x-auto px-4 py-2 md:grid md:gap-2 md:overflow-visible ${
              sidebarCollapsed ? "md:justify-center md:justify-items-center md:px-0" : "md:justify-start"
            }`}
          >
            {navItems.map((item) => {
              const active = isActiveRoute(currentPathname, item.href);
              const label = navLabel(item, tx);
              return (
                <a
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  className={navLinkClasses({ active, collapsed: sidebarCollapsed })}
                  data-active-route={active ? "true" : undefined}
                  href={item.href}
                  key={item.href}
                  title={label}
                >
                  {active ? (
                    <span
                      aria-hidden="true"
                      className="absolute left-1 top-1/2 hidden h-6 w-1 -translate-y-1/2 rounded-full bg-amber-500 md:block"
                      data-nav-active-accent="true"
                    />
                  ) : null}
                  <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                    {navIcon(item.href)}
                  </span>
                  <span className={`min-w-0 truncate text-sm font-medium ${sidebarCollapsed ? "md:hidden" : ""}`}>
                    {label}
                  </span>
                </a>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 border-b border-zinc-200 bg-[#fdfdfd]/95 px-4 py-3 shadow-[0_1px_3px_rgba(24,24,27,0.08)] backdrop-blur md:px-6">
            <div className="flex min-h-10 items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <HeaderBreadcrumbs breadcrumbs={headerBreadcrumbs} />
              </div>
              {headerAction ? (
                <div className="flex shrink-0 items-center justify-end text-xs font-medium text-zinc-500">
                  {headerAction}
                </div>
              ) : null}
            </div>
          </header>

          <main className="page-fade-in min-w-0 flex-1 px-4 py-5 md:px-6 md:py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}

export function StatePanel({ action, children, state, title }: StatePanelProps) {
  const tx = useT();
  const tone = stateTone[state];

  return (
    <section className={`rounded-lg border ${tone.panel} p-4 shadow-sm`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-xs font-semibold uppercase tracking-normal ${tone.label}`}>{tx(`state.${state}`)}</p>
          <h2 className="mt-1 text-sm font-semibold tracking-normal text-zinc-950">{title}</h2>
        </div>
        {action}
      </div>
      <div className="mt-3 text-sm leading-6 text-zinc-600">{children}</div>
    </section>
  );
}

export function WorkSurface({
  children,
  title,
  actions,
}: {
  children: ReactNode;
  title: string;
  actions?: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-zinc-200 bg-white shadow-sm">
      {actions !== undefined ? (
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
          <h2 className="text-sm font-semibold tracking-normal text-zinc-950">{title}</h2>
          {actions}
        </div>
      ) : (
        <div className="border-b border-zinc-200 px-4 py-3">
          <h2 className="text-sm font-semibold tracking-normal text-zinc-950">{title}</h2>
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PrimaryActionLink({ children, href }: { children: ReactNode; href: string }) {
  return (
    <a
      className={`inline-flex items-center justify-center rounded-md bg-amber-500 px-3 py-2 text-sm font-semibold text-zinc-950 shadow-sm transition hover:bg-amber-400 active:scale-95 ${focusClasses}`}
      href={href}
    >
      {children}
    </a>
  );
}

function HeaderBreadcrumbs({ breadcrumbs }: { breadcrumbs: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-2 text-xl font-semibold tracking-normal text-zinc-950">
        {breadcrumbs.map((item, index) => {
          const current = index === breadcrumbs.length - 1;
          return (
            <li className="flex min-w-0 items-center gap-2" key={`${item.href ?? "current"}-${index}`}>
              {index > 0 ? <span className="shrink-0 text-base font-medium text-zinc-400">/</span> : null}
              {current || !item.href ? (
                current ? (
                  <h1 className="truncate text-xl font-semibold tracking-normal text-zinc-950">{item.label}</h1>
                ) : (
                  <span className="truncate text-xl font-semibold tracking-normal text-zinc-700">{item.label}</span>
                )
              ) : (
                <a
                  className={`truncate rounded-md text-xl font-semibold tracking-normal text-amber-600 transition hover:text-amber-700 active:scale-95 ${focusClasses}`}
                  href={item.href}
                >
                  {item.label}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function isActiveRoute(currentPathname: string, href: string): boolean {
  return currentPathname === href || currentPathname.startsWith(`${href}/`);
}

function navLabel(item: NavItem, t: (key: string) => string): string {
  if (item.href === "/products") {
    return t("nav.products");
  }
  if (item.href === "/styles") {
    return t("nav.styles");
  }
  if (item.href === "/settings") {
    return t("nav.settings");
  }
  return item.label;
}

function navIcon(href: string): JSX.Element {
  if (href === "/settings") {
    return (
      <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
        <path
          d="M12 8.25a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
        <path
          d="M12 4.5v2M12 17.5v2M5.5 12h2M16.5 12h2M7.4 7.4l1.4 1.4M15.2 15.2l1.4 1.4M16.6 7.4l-1.4 1.4M8.8 15.2l-1.4 1.4"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.7"
        />
      </svg>
    );
  }

  if (href === "/styles") {
    return (
      <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
        <path
          d="M12 4.75 4.75 8.5 12 12.25l7.25-3.75L12 4.75Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
        <path
          d="m5.75 12 6.25 3.25L18.25 12"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
        <path
          d="m5.75 15.35 6.25 3.25 6.25-3.25"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M6 6.5h3.5v3.5H6zM6 14h3.5v3.5H6z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="M13 7h5M13 15h5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9" />
      <path d="M13 10h3M13 18h3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}

function navLinkClasses({ active, collapsed }: { active: boolean; collapsed: boolean }): string {
  const activeClasses = collapsed
    ? "bg-white text-zinc-950 shadow-[0_1px_3px_rgba(24,24,27,0.10)] ring-1 ring-zinc-200 md:bg-transparent md:shadow-none md:ring-0"
    : "bg-white text-zinc-950 shadow-[0_1px_3px_rgba(24,24,27,0.10)] ring-1 ring-zinc-200";
  const inactiveClasses = "text-zinc-700 hover:bg-zinc-200/80 hover:text-zinc-950";
  const sizingClasses = collapsed
    ? "h-10 w-10 justify-center"
    : "h-11 w-11 justify-center md:w-full md:justify-start md:gap-3 md:px-3";

  return `relative inline-flex shrink-0 items-center rounded-xl text-left transition active:scale-95 ${sizingClasses} ${focusClasses} ${
    active ? activeClasses : inactiveClasses
  }`;
}

function sidebarToggleIcon(collapsed: boolean): JSX.Element {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <rect height="15" rx="4" stroke="currentColor" strokeWidth="1.8" width="16" x="4" y="4.5" />
      <path d={collapsed ? "M9 5v14" : "M15 5v14"} stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function routeLabel(value: string, t: (key: string) => string): string {
  if (value === "Products") {
    return t("nav.products");
  }
  if (value === "Styles") {
    return t("nav.styles");
  }
  if (value === "Settings") {
    return t("nav.settings");
  }
  return value;
}

const stateTone = {
  empty: {
    label: "text-zinc-500",
    panel: "border-zinc-200 bg-white",
  },
  error: {
    label: "text-red-700",
    panel: "border-red-200 bg-red-50",
  },
  loading: {
    label: "text-amber-700",
    panel: "border-amber-200 bg-amber-50",
  },
};
