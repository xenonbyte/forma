import type { CSSProperties, ReactNode } from "react";

import type { StyleMetadata } from "../api.js";
import { useT } from "../LocaleContext.js";
import { parseDesignMd, type ParsedDesignMd } from "../utils/parseDesignMd.js";

export type StylePreviewType = "mobile" | "desktop" | "tablet" | "web";

export interface StylePreviewPanelProps {
  designMd?: string;
  metadata: StyleMetadata;
  previewType: StylePreviewType;
}

interface ResolvedPreviewTokens {
  background: string;
  bodyFont: string;
  headingFont: string;
  primary: string;
  radius: string;
  spacing: string;
  textColor: string;
}

interface ComponentPreviewTokens {
  background: string;
  color: string;
  radius: string;
  source: string;
}

interface NavPreviewTokens {
  background: string;
  color: string;
  source: string;
}

const fallbackVariables = {
  primary: "#3b82f6",
  background: "#ffffff",
  "text-primary": "#111827",
  "font-heading": "Inter",
  "font-body": "Inter",
  "border-radius": "8px",
  "spacing-unit": "8px"
};

export function StylePreviewPanel({ designMd, metadata, previewType }: StylePreviewPanelProps) {
  const tx = useT();
  const parsed = parseDesignMd(designMd ?? "");
  const tokens = resolvePreviewTokens(parsed, metadata);
  const button = resolveButtonTokens(parsed, metadata, tokens);
  const nav = resolveNavTokens(parsed, metadata, tokens);
  const palette = paletteEntries(parsed, tokens);
  const previewLabel = tx(`platform.${previewType}`);

  return (
    <section
      className="rounded-lg border border-zinc-200 bg-white shadow-sm"
      data-background={tokens.background}
      data-body-font={tokens.bodyFont}
      data-button-background={button.background}
      data-button-color={button.color}
      data-button-source={button.source}
      data-heading-font={tokens.headingFont}
      data-nav-background={nav.background}
      data-nav-source={nav.source}
      data-preview-type={previewType}
      data-primary={tokens.primary}
      data-radius={tokens.radius}
      data-spacing={tokens.spacing}
      data-style-preview-panel="true"
      data-text-color={tokens.textColor}
    >
      <div className="border-b border-zinc-200 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{tx("style.preview.live")}</p>
            <h2 className="mt-1 truncate text-sm font-semibold tracking-normal text-zinc-950">{metadata.name}</h2>
          </div>
          <span className="shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-600">{previewLabel}</span>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{tx("style.preview.palette")}</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {palette.map((item) => (
                <div className="min-w-0" key={item.key}>
                  <span className="block h-9 rounded-md border border-zinc-200 shadow-inner" style={{ backgroundColor: item.value }} />
                  <span className="mt-1 block truncate font-mono text-[11px] leading-4 text-zinc-500">{item.key}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{tx("style.preview.type")}</p>
              <p className="mt-2 truncate text-base font-semibold text-zinc-950" style={{ fontFamily: tokens.headingFont }}>
                {tx("style.preview.mockTitle")}
              </p>
              <p className="mt-1 truncate text-sm text-zinc-600" style={{ fontFamily: tokens.bodyFont }}>
                {tx("style.preview.mockBody")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-medium text-zinc-600">
              <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5">
                {tx("style.preview.radius")}: {tokens.radius}
              </span>
              <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5">
                {tx("style.preview.spacing")}: {tokens.spacing}
              </span>
            </div>
          </div>
        </div>

        <div
          className="h-64 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 p-3"
          data-preview-mock={previewType}
          style={{ backgroundColor: tokens.background, color: tokens.textColor, fontFamily: tokens.bodyFont }}
        >
          {previewMock(previewType, { button, nav, tokens, tx })}
        </div>

        {parsed.warnings.length > 0 ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-semibold">{tx("style.preview.warnings")}</p>
            <ul className="mt-1 space-y-1">
              {parsed.warnings.map((warning) => (
                <li className="break-words" key={warning}>
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function resolvePreviewTokens(parsed: ParsedDesignMd, metadata: StyleMetadata): ResolvedPreviewTokens {
  const metadataVariables = metadata.variables;
  const metadataPrimary = metadataValue(metadataVariables?.primary, fallbackVariables.primary);
  const metadataBackground = metadataValue(metadataVariables?.background, fallbackVariables.background);
  const metadataTextColor = metadataValue(metadataVariables?.["text-primary"], fallbackVariables["text-primary"]);
  const metadataHeadingFont = metadataValue(metadataVariables?.["font-heading"], fallbackVariables["font-heading"]);
  const metadataBodyFont = metadataValue(metadataVariables?.["font-body"], metadataHeadingFont);
  const metadataRadius = metadataValue(metadataVariables?.["border-radius"], fallbackVariables["border-radius"]);
  const metadataSpacing = metadataValue(metadataVariables?.["spacing-unit"], fallbackVariables["spacing-unit"]);

  const primary = resolveWithFallback(pick(parsed.colors, ["primary"]), parsed, metadata, metadataPrimary);
  const background = resolveWithFallback(
    pick(parsed.colors, ["background", "canvas", "surface"]),
    parsed,
    metadata,
    metadataBackground
  );
  const textColor = resolveWithFallback(
    pick(parsed.colors, ["text-primary", "text", "foreground", "ink"]),
    parsed,
    metadata,
    metadataTextColor
  );
  const headingFont = resolveWithFallback(
    pick(parsed.typography, ["font-heading", "heading", "heading-lg", "display", "hero-display"]) ?? pickByName(parsed.typography, ["heading", "display"]),
    parsed,
    metadata,
    metadataHeadingFont
  );
  const bodyFont = resolveWithFallback(
    pick(parsed.typography, ["font-body", "body", "body-md", "body-lg"]) ?? pickByName(parsed.typography, ["body"]),
    parsed,
    metadata,
    metadataBodyFont
  );
  const radius = cssLength(
    resolveWithFallback(
      pick(parsed.rounded, ["border-radius", "radius", "lg", "md"]) ?? firstValue(parsed.rounded),
      parsed,
      metadata,
      metadataRadius
    )
  );
  const spacing = cssLength(
    resolveWithFallback(
      pick(parsed.spacing, ["spacing-unit", "unit", "md", "sm", "base"]) ?? firstValue(parsed.spacing),
      parsed,
      metadata,
      metadataSpacing
    )
  );

  return { background, bodyFont, headingFont, primary, radius, spacing, textColor };
}

function resolveButtonTokens(parsed: ParsedDesignMd, metadata: StyleMetadata, tokens: ResolvedPreviewTokens): ComponentPreviewTokens {
  const key = componentKey(parsed.components, "button-primary") ?? componentKey(parsed.components, "button");
  const component = key ? parsed.components[key] : undefined;
  return {
    background: resolveWithFallback(pick(component, ["backgroundColor", "background", "background-color", "bg"]), parsed, metadata, tokens.primary),
    color: resolveWithFallback(pick(component, ["textColor", "color", "text", "text-color"]), parsed, metadata, tokens.background),
    radius: cssLength(resolveWithFallback(pick(component, ["rounded", "border-radius", "radius"]), parsed, metadata, tokens.radius)),
    source: key ?? "fallback"
  };
}

function resolveNavTokens(parsed: ParsedDesignMd, metadata: StyleMetadata, tokens: ResolvedPreviewTokens): NavPreviewTokens {
  const key = componentKey(parsed.components, "nav");
  const component = key ? parsed.components[key] : undefined;
  return {
    background: resolveWithFallback(pick(component, ["backgroundColor", "background", "background-color", "bg"]), parsed, metadata, tokens.background),
    color: resolveWithFallback(pick(component, ["textColor", "color", "text", "text-color"]), parsed, metadata, tokens.textColor),
    source: key ?? "fallback"
  };
}

function paletteEntries(parsed: ParsedDesignMd, tokens: ResolvedPreviewTokens): Array<{ key: string; value: string }> {
  const parsedEntries = Object.entries(parsed.colors)
    .slice(0, 6)
    .map(([key, value]) => ({ key, value: resolveWithFallback(value, parsed, undefined, value) }));

  if (parsedEntries.length > 0) {
    return parsedEntries;
  }

  return [
    { key: "background", value: tokens.background },
    { key: "primary", value: tokens.primary },
    { key: "text-primary", value: tokens.textColor }
  ];
}

function pick(record: Record<string, string> | undefined, keys: string[]): string | undefined {
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = record[key]?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function pickByName(record: Record<string, string>, fragments: string[]): string | undefined {
  const entry = Object.entries(record).find(([key, value]) => value.trim().length > 0 && fragments.some((fragment) => key.toLowerCase().includes(fragment)));
  return entry?.[1];
}

function firstValue(record: Record<string, string>): string | undefined {
  return Object.values(record).find((value) => value.trim().length > 0);
}

function metadataValue(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function componentKey(components: Record<string, Record<string, string>>, fragment: string): string | undefined {
  const normalizedFragment = fragment.toLowerCase();
  return Object.keys(components).find((key) => key.toLowerCase().includes(normalizedFragment));
}

function resolveWithFallback(value: string | undefined, parsed: ParsedDesignMd, metadata: StyleMetadata | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }

  const resolved = resolveTokenValue(trimmed, parsed, metadata, new Set());
  if (resolved) {
    return resolved;
  }

  return isTokenReference(trimmed) ? fallback : trimmed;
}

function resolveTokenValue(value: string, parsed: ParsedDesignMd, metadata: StyleMetadata | undefined, seen: Set<string>): string | undefined {
  const token = tokenName(value);
  if (!token) {
    return value;
  }
  if (seen.has(token)) {
    return undefined;
  }
  seen.add(token);

  const raw = rawTokenValue(token, parsed, metadata);
  if (!raw) {
    return undefined;
  }

  return resolveTokenValue(raw, parsed, metadata, seen);
}

function rawTokenValue(token: string, parsed: ParsedDesignMd, metadata: StyleMetadata | undefined): string | undefined {
  if (token.startsWith("colors.")) {
    const key = token.slice("colors.".length);
    return parsed.colors[key] ?? metadataColorValue(metadata, key);
  }
  if (token.startsWith("typography.")) {
    const key = token.slice("typography.".length);
    return parsed.typography[key] ?? metadataTypographyValue(metadata, key);
  }
  if (token.startsWith("rounded.")) {
    const key = token.slice("rounded.".length);
    return parsed.rounded[key] ?? (key === "border-radius" ? metadata?.variables?.["border-radius"] : undefined);
  }
  if (token.startsWith("spacing.")) {
    const key = token.slice("spacing.".length);
    return parsed.spacing[key] ?? (key === "spacing-unit" ? metadata?.variables?.["spacing-unit"] : undefined);
  }
  if (token.startsWith("components.")) {
    return componentTokenValue(token.slice("components.".length), parsed.components);
  }

  return undefined;
}

function metadataColorValue(metadata: StyleMetadata | undefined, key: string): string | undefined {
  if (key === "primary" || key === "background" || key === "text-primary") {
    return metadata?.variables?.[key];
  }
  return undefined;
}

function metadataTypographyValue(metadata: StyleMetadata | undefined, key: string): string | undefined {
  if (key === "font-heading" || key === "heading") {
    return metadata?.variables?.["font-heading"];
  }
  if (key === "font-body" || key === "body" || key === "body-md") {
    return metadata?.variables?.["font-body"];
  }
  return undefined;
}

function componentTokenValue(path: string, components: Record<string, Record<string, string>>): string | undefined {
  const component = Object.keys(components)
    .filter((key) => path === key || path.startsWith(`${key}.`))
    .sort((left, right) => right.length - left.length)[0];
  if (!component) {
    return undefined;
  }

  const property = path.slice(component.length + 1);
  return property.length > 0 ? components[component]?.[property] : undefined;
}

function tokenName(value: string): string | undefined {
  const match = /^\{([A-Za-z0-9_.-]+)\}$/.exec(value);
  return match?.[1];
}

function isTokenReference(value: string): boolean {
  return tokenName(value) !== undefined;
}

function cssLength(value: string): string {
  return /^-?\d+(?:\.\d+)?$/.test(value) && value !== "0" ? `${value}px` : value;
}

function previewMock(
  previewType: StylePreviewType,
  context: {
    button: ComponentPreviewTokens;
    nav: NavPreviewTokens;
    tokens: ResolvedPreviewTokens;
    tx: (key: string) => string;
  }
): ReactNode {
  if (previewType === "mobile") {
    return <MobileMock {...context} />;
  }
  if (previewType === "desktop") {
    return <DesktopMock {...context} />;
  }
  if (previewType === "tablet") {
    return <TabletMock {...context} />;
  }
  return <WebMock {...context} />;
}

function MobileMock({
  button,
  nav,
  tokens,
  tx
}: {
  button: ComponentPreviewTokens;
  nav: NavPreviewTokens;
  tokens: ResolvedPreviewTokens;
  tx: (key: string) => string;
}) {
  return (
    <div className="mx-auto h-full w-36 rounded-[1.5rem] border border-zinc-300 bg-white p-2 shadow-sm" style={{ borderRadius: `calc(${tokens.radius} + 14px)` }}>
      <div className="h-full overflow-hidden border border-zinc-200 bg-white" style={{ borderRadius: tokens.radius }}>
        <div className="flex h-10 items-center justify-between px-3 text-xs font-semibold" style={{ backgroundColor: nav.background, color: nav.color }}>
          <span>{tx("style.preview.mockNav")}</span>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tokens.primary }} />
        </div>
        <div className="grid gap-2 p-3" style={{ gap: tokens.spacing }}>
          <div className="h-14 rounded-md border border-zinc-200 bg-zinc-50" />
          <div className="space-y-1">
            <div className="h-2.5 w-20 rounded-full bg-zinc-300" />
            <div className="h-2 w-24 rounded-full bg-zinc-200" />
          </div>
          <button className="h-8 rounded-md px-3 text-xs font-semibold" style={buttonStyle(button)}>
            {tx("style.preview.mockAction")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DesktopMock({
  button,
  nav,
  tokens,
  tx
}: {
  button: ComponentPreviewTokens;
  nav: NavPreviewTokens;
  tokens: ResolvedPreviewTokens;
  tx: (key: string) => string;
}) {
  return (
    <div className="grid h-full grid-cols-[5rem_minmax(0,1fr)] overflow-hidden rounded-md border border-zinc-200 bg-white" style={{ borderRadius: tokens.radius }}>
      <div className="p-2 text-xs font-semibold" style={{ backgroundColor: nav.background, color: nav.color }}>
        {tx("style.preview.mockNav")}
      </div>
      <div className="grid min-w-0 grid-rows-[auto_1fr]">
        <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2">
          <span className="truncate text-sm font-semibold" style={{ fontFamily: tokens.headingFont }}>
            {tx("style.preview.mockTitle")}
          </span>
          <button className="rounded-md px-3 py-1.5 text-xs font-semibold" style={buttonStyle(button)}>
            {tx("style.preview.mockAction")}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2 p-3" style={{ gap: tokens.spacing }}>
          {[0, 1, 2].map((item) => (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2" key={item} style={{ borderRadius: tokens.radius }}>
              <div className="h-2 w-10 rounded-full bg-zinc-300" />
              <div className="mt-4 h-12 rounded bg-white" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TabletMock({
  button,
  nav,
  tokens,
  tx
}: {
  button: ComponentPreviewTokens;
  nav: NavPreviewTokens;
  tokens: ResolvedPreviewTokens;
  tx: (key: string) => string;
}) {
  return (
    <div className="mx-auto h-full max-w-md overflow-hidden rounded-xl border border-zinc-200 bg-white" style={{ borderRadius: `calc(${tokens.radius} + 4px)` }}>
      <div className="flex items-center justify-between px-4 py-3 text-sm font-semibold" style={{ backgroundColor: nav.background, color: nav.color }}>
        <span>{tx("style.preview.mockNav")}</span>
        <button className="rounded-md px-3 py-1.5 text-xs font-semibold" style={buttonStyle(button)}>
          {tx("style.preview.mockAction")}
        </button>
      </div>
      <div className="grid grid-cols-[1fr_8rem] gap-3 p-4" style={{ gap: tokens.spacing }}>
        <div className="min-w-0 rounded-md border border-zinc-200 bg-zinc-50 p-3" style={{ borderRadius: tokens.radius }}>
          <p className="truncate text-sm font-semibold" style={{ fontFamily: tokens.headingFont }}>
            {tx("style.preview.mockTitle")}
          </p>
          <div className="mt-6 h-16 rounded bg-white" />
        </div>
        <div className="rounded-md border border-zinc-200 bg-white p-3" style={{ borderRadius: tokens.radius }}>
          <div className="h-3 w-14 rounded-full bg-zinc-300" />
          <div className="mt-3 h-20 rounded bg-zinc-100" />
        </div>
      </div>
    </div>
  );
}

function WebMock({
  button,
  nav,
  tokens,
  tx
}: {
  button: ComponentPreviewTokens;
  nav: NavPreviewTokens;
  tokens: ResolvedPreviewTokens;
  tx: (key: string) => string;
}) {
  return (
    <div className="h-full overflow-hidden rounded-md border border-zinc-200 bg-white" style={{ borderRadius: tokens.radius }}>
      <div className="flex h-11 items-center justify-between px-4 text-sm font-semibold" style={{ backgroundColor: nav.background, color: nav.color }}>
        <span>{tx("style.preview.mockNav")}</span>
        <div className="flex gap-2">
          <span className="h-2 w-8 rounded-full bg-current opacity-35" />
          <span className="h-2 w-8 rounded-full bg-current opacity-35" />
        </div>
      </div>
      <div className="grid h-[calc(100%-2.75rem)] grid-cols-[minmax(0,1fr)_9rem] gap-3 p-4" style={{ gap: tokens.spacing }}>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold" style={{ fontFamily: tokens.headingFont }}>
            {tx("style.preview.mockTitle")}
          </p>
          <p className="mt-1 truncate text-sm text-zinc-500">{tx("style.preview.mockBody")}</p>
          <button className="mt-4 rounded-md px-3 py-2 text-xs font-semibold" style={buttonStyle(button)}>
            {tx("style.preview.mockAction")}
          </button>
        </div>
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3" style={{ borderRadius: tokens.radius }}>
          <div className="h-3 w-16 rounded-full bg-zinc-300" />
          <div className="mt-4 h-20 rounded bg-white" />
        </div>
      </div>
    </div>
  );
}

function buttonStyle(button: ComponentPreviewTokens): CSSProperties {
  return {
    backgroundColor: button.background,
    borderRadius: button.radius,
    color: button.color
  };
}
