import type { CSSProperties } from "react";

import type { StyleMetadata } from "../api.js";
import type { StyleVisualTokens } from "../utils/styleVisualTokens.js";

export interface StyleCardProps {
  href: string;
  style: StyleMetadata;
  visualTokens?: StyleVisualTokens;
}

const focusClasses = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500";

export function StyleCard({ href, style, visualTokens }: StyleCardProps) {
  const cardStyle = styleFromVisualTokens(visualTokens);
  const textStyle = textStyleFromVisualTokens(visualTokens);
  const hasColorBars = Boolean(visualTokens?.primaryColor || visualTokens?.secondaryColor);

  return (
    <a
      className={`relative block rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-amber-200 hover:bg-amber-50/40 active:scale-[0.99] ${focusClasses}`}
      href={href}
      style={cardStyle}
    >
      {hasColorBars ? (
        <div aria-label="Style colors" className="absolute right-3 top-3 flex overflow-hidden rounded-full border border-black/10 bg-white/70 shadow-sm">
          {visualTokens?.primaryColor ? (
            <span aria-label="Primary" className="block h-3 w-7" data-style-primary-color="true" style={{ backgroundColor: visualTokens.primaryColor }} />
          ) : null}
          {visualTokens?.secondaryColor ? (
            <span aria-label="Secondary" className="block h-3 w-7" data-style-secondary-color="true" style={{ backgroundColor: visualTokens.secondaryColor }} />
          ) : null}
        </div>
      ) : null}

      <div className={`min-w-0 ${hasColorBars ? "pr-16" : ""}`} style={textStyle}>
        <h3 className="truncate text-sm font-semibold tracking-normal text-zinc-950" style={textStyle}>
          {style.name}
        </h3>
        <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-600" style={textStyle}>
          {style.description}
        </p>
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

function styleFromVisualTokens(visualTokens: StyleVisualTokens | undefined): CSSProperties | undefined {
  if (!visualTokens?.backgroundColor && !visualTokens?.fontFamily) {
    return undefined;
  }

  return {
    ...(visualTokens.backgroundColor ? { backgroundColor: visualTokens.backgroundColor } : {}),
    ...(visualTokens.fontFamily ? { fontFamily: visualTokens.fontFamily } : {})
  };
}

function textStyleFromVisualTokens(visualTokens: StyleVisualTokens | undefined): CSSProperties | undefined {
  if (!visualTokens?.fontFamily && !visualTokens?.textColor) {
    return undefined;
  }

  return {
    ...(visualTokens.fontFamily ? { fontFamily: visualTokens.fontFamily } : {}),
    ...(visualTokens.textColor ? { color: visualTokens.textColor } : {})
  };
}
