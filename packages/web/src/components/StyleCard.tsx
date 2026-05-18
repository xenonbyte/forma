import type { StyleMetadata } from "../api.js";

export interface StyleCardProps {
  href: string;
  style: StyleMetadata;
}

const focusClasses = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";

export function StyleCard({ href, style }: StyleCardProps) {
  const variables = style.variables ?? {};
  const variableEntries = Object.entries(variables);
  const accent = variables.primary ?? variables["text-primary"] ?? "#71717a";
  const variableLabel = `${variableEntries.length} ${variableEntries.length === 1 ? "variable" : "variables"}`;

  return (
    <a
      className={`block rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-amber-200 hover:bg-amber-50/40 active:scale-[0.99] ${focusClasses}`}
      href={href}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold tracking-normal text-zinc-950">{style.name}</h3>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-600">{style.description}</p>
        </div>
        <span
          aria-label={`Primary color ${accent}`}
          className="h-8 w-8 shrink-0 rounded-md border border-zinc-200 shadow-inner"
          style={{ backgroundColor: accent }}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-medium text-zinc-500">
        <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1">{variableLabel}</span>
        <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1">{accent}</span>
      </div>
    </a>
  );
}
