import type { StyleMetadata } from "../api.js";

export interface StyleCardProps {
  href: string;
  style: StyleMetadata;
}

const focusClasses = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";

export function StyleCard({ href, style }: StyleCardProps) {
  const category = style.category ?? deriveCategory(style);

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
        {category ? (
          <span className="shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-500">{category}</span>
        ) : null}
      </div>

      <div className="mt-4 flex gap-2 text-xs text-zinc-500">
        {style.upstream ? (
          <span className="truncate rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1">{style.upstream}</span>
        ) : null}
        <span className="ml-auto truncate font-mono text-zinc-400">{style.tokens_css_path.split("/").pop()}</span>
      </div>
    </a>
  );
}

function deriveCategory(style: StyleMetadata): string {
  const [, category] = style.design_md_path.split("/");
  return category || style.name.split(/\s+/)[0]?.toLowerCase() || style.name.toLowerCase();
}
