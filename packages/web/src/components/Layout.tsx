import type { JSX, ReactNode } from "react";

import { useLocale, useT } from "../LocaleContext.js";
import type { Locale } from "../i18n.js";

export interface NavItem {
  href: string;
  label: string;
  meta: string;
}

export interface LayoutProps {
  children: ReactNode;
  currentPathname: string;
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

export function Layout({ children, currentPathname, navItems, routeContext, title }: LayoutProps) {
  const { locale, setLocale } = useLocale();
  const tx = useT();

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-zinc-950">
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside className="w-full shrink-0 border-b border-zinc-300 bg-[#f1f3f5] shadow-[inset_-1px_0_0_rgba(24,24,27,0.06)] md:w-64 md:border-b-0 md:border-r">
          <div className="border-b border-zinc-300 px-4 py-4">
            <a
              className={`inline-flex rounded-md text-base font-semibold tracking-normal text-zinc-950 active:scale-95 ${focusClasses}`}
              href="/products"
            >
              Forma
            </a>
            <p className="mt-1 text-xs font-medium text-zinc-500">{tx("app.adminWorkbench")}</p>
          </div>

          <nav aria-label="Primary" className="flex gap-1 overflow-x-auto px-3 py-3 md:block md:space-y-1 md:overflow-visible">
            {navItems.map((item) => {
              const active = isActiveRoute(currentPathname, item.href);
              return (
                <a
                  aria-current={active ? "page" : undefined}
                  className={`relative flex min-w-44 items-start gap-3 rounded-md px-3 py-2.5 text-left transition active:scale-95 md:min-w-0 ${focusClasses} ${
                    active
                      ? "bg-white text-zinc-950 shadow-[0_1px_3px_rgba(24,24,27,0.10)] ring-1 ring-zinc-200"
                      : "text-zinc-600 hover:bg-white/80 hover:text-zinc-950 hover:shadow-sm"
                  }`}
                  data-active-route={active ? "true" : undefined}
                  href={item.href}
                  key={item.href}
                >
                  {active ? (
                    <span
                      aria-hidden="true"
                      className="absolute left-1.5 top-3 h-7 w-1 rounded-full bg-amber-500"
                      data-nav-active-accent="true"
                    />
                  ) : null}
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                      active ? "bg-amber-50 text-amber-700" : "bg-white text-zinc-500 shadow-sm"
                    }`}
                  >
                    {navIcon(item.href)}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{navLabel(item, tx)}</span>
                    <span className="mt-0.5 block truncate text-xs text-zinc-500">{navMeta(item, tx)}</span>
                  </span>
                </a>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 border-b border-zinc-200 bg-[#fdfdfd]/95 px-4 py-3 shadow-[0_1px_3px_rgba(24,24,27,0.08)] backdrop-blur md:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-normal text-zinc-500">{routeLabel(routeContext, tx)}</p>
                <h1 className="mt-1 truncate text-xl font-semibold tracking-normal text-zinc-950">{routeLabel(title, tx)}</h1>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-zinc-500">
                <div className="inline-flex rounded-md border border-zinc-200 bg-white p-0.5" aria-label="Language">
                  {languageChoices.map((choice) => (
                    <button
                      aria-pressed={locale === choice.value}
                      className={`rounded px-2 py-1 text-xs font-semibold transition active:scale-95 ${focusClasses} ${
                        locale === choice.value ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
                      }`}
                      key={choice.value}
                      onClick={() => setLocale(choice.value)}
                      type="button"
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
                <span className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5">{tx("app.clientShell")}</span>
                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-zinc-600">{tx("app.idle")}</span>
              </div>
            </div>
          </header>

          <main className="page-fade-in min-w-0 flex-1 px-4 py-5 md:px-6 md:py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}

const languageChoices: Array<{ label: string; value: Locale }> = [
  { label: "EN", value: "en" },
  { label: "中", value: "zh" }
];

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

export function WorkSurface({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="min-w-0 rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-normal text-zinc-950">{title}</h2>
      </div>
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
  return item.label;
}

function navMeta(item: NavItem, t: (key: string) => string): string {
  if (item.href === "/products") {
    return t("nav.products.meta");
  }
  if (item.href === "/styles") {
    return t("nav.styles.meta");
  }
  return item.meta;
}

function navIcon(href: string): JSX.Element {
  if (href === "/styles") {
    return (
      <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
        <path d="M5 7.5h14M5 12h14M5 16.5h9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        <path d="M5 4.75h14v14.5H5z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path d="M5 5.5h14v5H5zM5 13.5h6v5H5zM14 13.5h5v5h-5z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
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
  return value;
}

const stateTone = {
  empty: {
    label: "text-zinc-500",
    panel: "border-zinc-200 bg-white"
  },
  error: {
    label: "text-red-700",
    panel: "border-red-200 bg-red-50"
  },
  loading: {
    label: "text-amber-700",
    panel: "border-amber-200 bg-amber-50"
  }
};
