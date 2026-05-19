import type { StyleMetadata } from "../api.js";

export interface StyleCardProps {
  href: string;
  style: StyleMetadata;
}

const focusClasses = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";

export function StyleCard({ href, style }: StyleCardProps) {
  const variables = style.variables ?? {};
  const variableEntries = Object.entries(variables);
  const preview = stylePreviewTokens(variables);
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
        <span className="shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-500">{variableLabel}</span>
      </div>

      <div
        className="mt-4"
        data-background={preview.background}
        data-body-font={preview.bodyFont}
        data-heading-font={preview.headingFont}
        data-primary={preview.primary}
        data-radius={preview.radius}
        data-spacing={preview.spacing}
        data-style-preview-strip="true"
        data-text-color={preview.textColor}
      >
        <div className="grid h-9 grid-cols-[1fr_1fr_1fr] overflow-hidden border border-zinc-200 shadow-inner" style={{ borderRadius: preview.radius }}>
          <span aria-label={`Background color ${preview.background}`} style={{ backgroundColor: preview.background }} />
          <span aria-label={`Primary color ${preview.primary}`} style={{ backgroundColor: preview.primary }} />
          <span aria-label={`Text color ${preview.textColor}`} style={{ backgroundColor: preview.textColor }} />
        </div>
        <div className="mt-3 flex min-h-9 items-center justify-between border-t border-zinc-100 pt-3 text-xs text-zinc-500" style={{ gap: preview.spacing }}>
          <div className="min-w-0">
            <p className="truncate font-semibold text-zinc-950" style={{ fontFamily: preview.headingFont }}>
              Aa Heading
            </p>
            <p className="mt-0.5 truncate" style={{ fontFamily: preview.bodyFont }}>
              Body text
            </p>
          </div>
          <span className="shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-medium text-zinc-600">{preview.radius}</span>
        </div>
      </div>
    </a>
  );
}

function stylePreviewTokens(variables: Partial<StyleMetadata["variables"]>) {
  return {
    background: tokenValue(variables.background, "#ffffff"),
    primary: tokenValue(variables.primary ?? variables["text-primary"], "#71717a"),
    textColor: tokenValue(variables["text-primary"], "#111827"),
    headingFont: tokenValue(variables["font-heading"], "Inter"),
    bodyFont: tokenValue(variables["font-body"] ?? variables["font-heading"], "Inter"),
    radius: cssLength(tokenValue(variables["border-radius"], "8px")),
    spacing: cssLength(tokenValue(variables["spacing-unit"], "8px"))
  };
}

function tokenValue(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function cssLength(value: string): string {
  return /^-?\d+(?:\.\d+)?$/.test(value) && value !== "0" ? `${value}px` : value;
}
