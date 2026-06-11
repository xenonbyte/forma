import type { ReactNode } from "react";
import { useT } from "../LocaleContext.js";

export interface CanvasShellProps {
  backHref: string;
  productName: string;
  typeName: string;
  children: ReactNode;
}

const focusClasses =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";

/** Full-screen canvas wrapper: a thin top bar (back + product · type) over a flood-fill body. */
export function CanvasShell({ backHref, productName, typeName, children }: CanvasShellProps) {
  const t = useT();
  return (
    <div data-testid="canvas-shell" className="flex h-screen flex-col bg-[#f7f8fa] text-zinc-950">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-200 bg-[#fdfdfd] px-3">
        <a
          aria-label={t("canvas.back")}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-xl text-zinc-700 transition hover:bg-zinc-200/80 hover:text-zinc-950 active:scale-95 ${focusClasses}`}
          href={backHref}
        >
          <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
            <path
              d="M14.5 6 9 12l5.5 6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-zinc-950">{productName}</span>
          <span className="text-zinc-300">·</span>
          <span className="shrink-0 text-sm font-medium text-zinc-500">{typeName}</span>
        </div>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
