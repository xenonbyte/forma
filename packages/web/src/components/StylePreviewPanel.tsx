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

export interface MultiPlatformStylePreviewPanelProps {
  designMd?: string;
  metadata: StyleMetadata;
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

const fallbackTokens = {
  primary: "#3b82f6",
  background: "#ffffff",
  "text-primary": "#111827",
  "font-heading": "Inter",
  "font-body": "Inter",
  "border-radius": "8px",
  "spacing-unit": "8px",
};

const previewTypes: StylePreviewType[] = ["web", "mobile", "tablet", "desktop"];

export function StylePreviewPanel({ designMd, metadata, previewType }: StylePreviewPanelProps) {
  const tx = useT();
  const parsed = parseDesignMd(designMd ?? "");
  const tokens = resolvePreviewTokens(parsed);
  const button = resolveButtonTokens(parsed, tokens);
  const nav = resolveNavTokens(parsed, tokens);
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
          <span className="shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-600">
            {previewLabel}
          </span>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
              {tx("style.preview.palette")}
            </p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {palette.map((item) => (
                <div className="min-w-0" key={item.key}>
                  <span
                    className="block h-9 rounded-md border border-zinc-200 shadow-inner"
                    style={{ backgroundColor: item.value }}
                  />
                  <span className="mt-1 block truncate font-mono text-[11px] leading-4 text-zinc-500">{item.key}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
                {tx("style.preview.type")}
              </p>
              <p
                className="mt-2 truncate text-base font-semibold text-zinc-950"
                style={{ fontFamily: tokens.headingFont }}
              >
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

export function MultiPlatformStylePreviewPanel({ designMd, metadata }: MultiPlatformStylePreviewPanelProps) {
  const tx = useT();
  const parsed = parseDesignMd(designMd ?? "");
  const tokens = resolvePreviewTokens(parsed);
  const button = resolveButtonTokens(parsed, tokens);
  const nav = resolveNavTokens(parsed, tokens);
  const palette = paletteEntries(parsed, tokens).slice(0, 8);

  return (
    <section
      className="h-full min-w-0 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
      data-background={tokens.background}
      data-body-font={tokens.bodyFont}
      data-button-background={button.background}
      data-button-color={button.color}
      data-heading-font={tokens.headingFont}
      data-nav-background={nav.background}
      data-primary={tokens.primary}
      data-radius={tokens.radius}
      data-spacing={tokens.spacing}
      data-style-preview-grid="true"
      data-text-color={tokens.textColor}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold tracking-normal text-zinc-950">
            {formatPreviewName(metadata.name)} {tx("stylePicker.stylePreview")}
          </h3>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-3">
          {palette.map((item) => (
            <div className="grid justify-items-center gap-1" key={item.key}>
              <span
                className="block h-4 w-4 rounded-[3px] border border-zinc-200 shadow-sm"
                style={{ backgroundColor: item.value }}
              />
              <span className="max-w-14 truncate font-mono text-[9px] leading-3 text-zinc-500">{item.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {previewTypes.map((previewType) => (
          <section
            className="min-w-0 rounded-lg border border-zinc-200 bg-white p-2.5 shadow-[0_1px_2px_rgba(24,24,27,0.04)]"
            key={previewType}
          >
            <h4 className="px-1 pb-2 text-sm font-semibold tracking-normal text-zinc-950">
              {platformPreviewLabel(previewType)}
            </h4>
            <div
              className="h-32 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 p-2"
              data-preview-mock={previewType}
              style={{ backgroundColor: tokens.background, color: tokens.textColor, fontFamily: tokens.bodyFont }}
            >
              {previewMock(previewType, { button, nav, tokens, tx })}
            </div>
          </section>
        ))}
      </div>

      {parsed.warnings.length > 0 ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
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
    </section>
  );
}

function platformPreviewLabel(previewType: StylePreviewType): string {
  if (previewType === "web") return "Web";
  if (previewType === "mobile") return "Mobile";
  if (previewType === "tablet") return "Tablet";
  return "Desktop";
}

function formatPreviewName(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function resolvePreviewTokens(parsed: ParsedDesignMd): ResolvedPreviewTokens {
  const primary = resolveWithFallback(pick(parsed.colors, ["primary"]), parsed, fallbackTokens.primary);
  const background = resolveWithFallback(
    pick(parsed.colors, ["background", "canvas", "surface"]),
    parsed,
    fallbackTokens.background,
  );
  const textColor = resolveWithFallback(
    pick(parsed.colors, ["text-primary", "text", "foreground", "ink"]),
    parsed,
    fallbackTokens["text-primary"],
  );
  const headingFont = resolveWithFallback(
    pick(parsed.typography, ["font-heading", "heading", "heading-lg", "display", "hero-display"]) ??
      pickByName(parsed.typography, ["heading", "display"]),
    parsed,
    fallbackTokens["font-heading"],
  );
  const bodyFont = resolveWithFallback(
    pick(parsed.typography, ["font-body", "body", "body-md", "body-lg"]) ?? pickByName(parsed.typography, ["body"]),
    parsed,
    fallbackTokens["font-body"],
  );
  const radius = cssLength(
    resolveWithFallback(
      pick(parsed.rounded, ["border-radius", "radius", "lg", "md"]) ?? firstValue(parsed.rounded),
      parsed,
      fallbackTokens["border-radius"],
    ),
  );
  const spacing = cssLength(
    resolveWithFallback(
      pick(parsed.spacing, ["spacing-unit", "unit", "md", "sm", "base"]) ?? firstValue(parsed.spacing),
      parsed,
      fallbackTokens["spacing-unit"],
    ),
  );

  return { background, bodyFont, headingFont, primary, radius, spacing, textColor };
}

function resolveButtonTokens(parsed: ParsedDesignMd, tokens: ResolvedPreviewTokens): ComponentPreviewTokens {
  const key = componentKey(parsed.components, "button-primary") ?? componentKey(parsed.components, "button");
  const component = key ? parsed.components[key] : undefined;
  return {
    background: resolveWithFallback(
      pick(component, ["backgroundColor", "background", "background-color", "bg"]),
      parsed,
      tokens.primary,
    ),
    color: resolveWithFallback(
      pick(component, ["textColor", "color", "text", "text-color"]),
      parsed,
      tokens.background,
    ),
    radius: cssLength(
      resolveWithFallback(pick(component, ["rounded", "border-radius", "radius"]), parsed, tokens.radius),
    ),
    source: key ?? "fallback",
  };
}

function resolveNavTokens(parsed: ParsedDesignMd, tokens: ResolvedPreviewTokens): NavPreviewTokens {
  const key = componentKey(parsed.components, "nav");
  const component = key ? parsed.components[key] : undefined;
  return {
    background: resolveWithFallback(
      pick(component, ["backgroundColor", "background", "background-color", "bg"]),
      parsed,
      tokens.background,
    ),
    color: resolveWithFallback(pick(component, ["textColor", "color", "text", "text-color"]), parsed, tokens.textColor),
    source: key ?? "fallback",
  };
}

function paletteEntries(parsed: ParsedDesignMd, tokens: ResolvedPreviewTokens): Array<{ key: string; value: string }> {
  const parsedEntries = Object.entries(parsed.colors)
    .slice(0, 6)
    .map(([key, value]) => ({ key, value: resolveWithFallback(value, parsed, value) }));

  if (parsedEntries.length > 0) {
    return parsedEntries;
  }

  return [
    { key: "background", value: tokens.background },
    { key: "primary", value: tokens.primary },
    { key: "text-primary", value: tokens.textColor },
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
  const entry = Object.entries(record).find(
    ([key, value]) => value.trim().length > 0 && fragments.some((fragment) => key.toLowerCase().includes(fragment)),
  );
  return entry?.[1];
}

function firstValue(record: Record<string, string>): string | undefined {
  return Object.values(record).find((value) => value.trim().length > 0);
}

function componentKey(components: Record<string, Record<string, string>>, fragment: string): string | undefined {
  const normalizedFragment = fragment.toLowerCase();
  return Object.keys(components).find((key) => key.toLowerCase().includes(normalizedFragment));
}

function resolveWithFallback(value: string | undefined, parsed: ParsedDesignMd, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }

  const resolved = resolveTokenValue(trimmed, parsed, new Set());
  if (resolved) {
    return resolved;
  }

  return isTokenReference(trimmed) ? fallback : trimmed;
}

function resolveTokenValue(value: string, parsed: ParsedDesignMd, seen: Set<string>): string | undefined {
  const token = tokenName(value);
  if (!token) {
    return value;
  }
  if (seen.has(token)) {
    return undefined;
  }
  seen.add(token);

  const raw = rawTokenValue(token, parsed);
  if (!raw) {
    return undefined;
  }

  return resolveTokenValue(raw, parsed, seen);
}

function rawTokenValue(token: string, parsed: ParsedDesignMd): string | undefined {
  if (token.startsWith("colors.")) {
    const key = token.slice("colors.".length);
    return parsed.colors[key];
  }
  if (token.startsWith("typography.")) {
    const key = token.slice("typography.".length);
    return parsed.typography[key];
  }
  if (token.startsWith("rounded.")) {
    const key = token.slice("rounded.".length);
    return parsed.rounded[key];
  }
  if (token.startsWith("spacing.")) {
    const key = token.slice("spacing.".length);
    return parsed.spacing[key];
  }
  if (token.startsWith("components.")) {
    return componentTokenValue(token.slice("components.".length), parsed.components);
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
  },
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
  tx: _tx,
}: {
  button: ComponentPreviewTokens;
  nav: NavPreviewTokens;
  tokens: ResolvedPreviewTokens;
  tx: (key: string) => string;
}) {
  return (
    <div
      className="mx-auto h-full w-24 rounded-[1.35rem] border border-zinc-300 bg-white p-1.5 shadow-sm"
      style={{ borderRadius: `calc(${tokens.radius} + 12px)` }}
    >
      <div
        className="h-full overflow-hidden border border-zinc-200 bg-white text-[7px]"
        style={{ borderRadius: tokens.radius }}
      >
        <div
          className="flex h-6 items-center justify-between px-2 font-semibold"
          style={{ backgroundColor: nav.background, color: nav.color }}
        >
          <span>项目管理</span>
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tokens.primary }} />
        </div>
        <div className="space-y-1.5 p-2">
          <div className="rounded border border-zinc-200 px-1.5 py-1 text-zinc-400">搜索项目</div>
          <div className="grid grid-cols-4 gap-1 text-center">
            {["全部", "进行中", "完成", "逾期"].map((item, index) => (
              <span className={index === 0 ? "font-semibold text-zinc-950" : "text-zinc-400"} key={item}>
                {item}
              </span>
            ))}
          </div>
          {[0, 1, 2].map((row) => (
            <div className="flex items-center gap-1 rounded border border-zinc-100 px-1 py-0.5" key={row}>
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: tokens.primary }} />
              <span className="min-w-0 flex-1 truncate">官网改版</span>
              <span className="rounded bg-amber-50 px-1 text-amber-700">进行中</span>
            </div>
          ))}
          <button
            className="mx-auto mt-1 flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold"
            style={buttonStyle(button)}
            type="button"
          >
            +
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
  tx: _tx,
}: {
  button: ComponentPreviewTokens;
  nav: NavPreviewTokens;
  tokens: ResolvedPreviewTokens;
  tx: (key: string) => string;
}) {
  return (
    <div
      className="grid h-full grid-cols-[4rem_minmax(0,1fr)] overflow-hidden rounded-md border border-zinc-200 bg-white text-[8px]"
      style={{ borderRadius: tokens.radius }}
    >
      <div className="space-y-1.5 p-2 font-medium" style={{ backgroundColor: nav.background, color: nav.color }}>
        <div className="font-semibold">数据中心</div>
        {["概览", "客户", "项目", "设置"].map((item, index) => (
          <div className={`rounded px-1.5 py-1 ${index === 1 ? "bg-amber-50 text-amber-700" : ""}`} key={item}>
            {item}
          </div>
        ))}
      </div>
      <div className="min-w-0 p-2">
        <div className="flex items-center justify-between">
          <span className="truncate text-[10px] font-semibold text-zinc-950" style={{ fontFamily: tokens.headingFont }}>
            客户列表
          </span>
          <button className="rounded px-2 py-1 text-[8px] font-semibold" style={buttonStyle(button)} type="button">
            + 新记录
          </button>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1">
          {["256", "142", "68", "46"].map((value) => (
            <div className="rounded border border-zinc-200 px-1.5 py-1" key={value}>
              <div className="font-semibold text-zinc-950">{value}</div>
              <div className="text-emerald-600">+10%</div>
            </div>
          ))}
        </div>
        <div className="mt-2 rounded border border-zinc-200">
          {[0, 1, 2].map((row) => (
            <div
              className="grid grid-cols-[1fr_2.5rem_2.5rem_3rem] gap-1 border-b border-zinc-100 px-1.5 py-1 last:border-b-0"
              key={row}
            >
              <span className="truncate">客户名称</span>
              <span>张三</span>
              <span>65%</span>
              <span className={row === 2 ? "text-red-500" : "text-emerald-600"}>{row === 2 ? "风险" : "合作中"}</span>
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
  tx: _tx,
}: {
  button: ComponentPreviewTokens;
  nav: NavPreviewTokens;
  tokens: ResolvedPreviewTokens;
  tx: (key: string) => string;
}) {
  return (
    <div
      className="mx-auto h-full max-w-md overflow-hidden rounded-xl border border-zinc-200 bg-white text-[8px]"
      style={{ borderRadius: `calc(${tokens.radius} + 4px)` }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 font-semibold"
        style={{ backgroundColor: nav.background, color: nav.color }}
      >
        <span>项目管理</span>
        <button className="rounded px-2 py-1 text-[8px] font-semibold" style={buttonStyle(button)} type="button">
          打开
        </button>
      </div>
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2 p-2" style={{ gap: tokens.spacing }}>
        <div
          className="space-y-1 rounded-md border border-zinc-200 bg-zinc-50 p-2"
          style={{ borderRadius: tokens.radius }}
        >
          {["官网改版", "移动端重构", "数据看板"].map((item, index) => (
            <div className={`rounded px-1.5 py-1 ${index === 0 ? "bg-amber-50 text-amber-700" : ""}`} key={item}>
              {item}
            </div>
          ))}
        </div>
        <div className="min-w-0 rounded-md border border-zinc-200 bg-white p-2" style={{ borderRadius: tokens.radius }}>
          <p className="truncate text-[10px] font-semibold text-zinc-950" style={{ fontFamily: tokens.headingFont }}>
            官网改版
          </p>
          <div className="mt-2 h-1.5 rounded-full bg-zinc-100">
            <div className="h-full w-2/3 rounded-full bg-emerald-500" />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1">
            <div className="rounded bg-zinc-50 p-1">负责人 张三</div>
            <div className="rounded bg-zinc-50 p-1">进度 65%</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WebMock({
  button,
  nav,
  tokens,
  tx: _tx,
}: {
  button: ComponentPreviewTokens;
  nav: NavPreviewTokens;
  tokens: ResolvedPreviewTokens;
  tx: (key: string) => string;
}) {
  return (
    <div
      className="h-full overflow-hidden rounded-md border border-zinc-200 bg-white text-[8px]"
      style={{ borderRadius: tokens.radius }}
    >
      <div
        className="flex h-7 items-center justify-between border-b border-zinc-200 px-2 font-semibold"
        style={{ backgroundColor: nav.background, color: nav.color }}
      >
        <span>项目管理</span>
        <div className="flex gap-2">
          {["概览", "项目", "任务", "日志"].map((item, index) => (
            <span className={index === 1 ? "text-amber-600" : "text-zinc-500"} key={item}>
              {item}
            </span>
          ))}
        </div>
      </div>
      <div className="p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="rounded border border-zinc-200 px-2 py-1 text-zinc-400">搜索项目、任务或成员</div>
          <button className="rounded px-2 py-1 font-semibold" style={buttonStyle(button)} type="button">
            + 新建项目
          </button>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1">
          {["128", "56", "72", "8"].map((value, index) => (
            <div className="rounded border border-zinc-200 p-1.5" key={value} style={{ borderRadius: tokens.radius }}>
              <div className="font-semibold text-zinc-950">{value}</div>
              <div className={index === 3 ? "text-red-500" : "text-emerald-600"}>{index === 3 ? "-5%" : "+12%"}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 rounded border border-zinc-200">
          {[0, 1, 2].map((row) => (
            <div
              className="grid grid-cols-[1fr_2.5rem_2.5rem_3rem] gap-1 border-b border-zinc-100 px-1.5 py-1 last:border-b-0"
              key={row}
            >
              <span className="truncate">官网改版</span>
              <span>张三</span>
              <span>65%</span>
              <span className="text-amber-600">进行中</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function buttonStyle(button: ComponentPreviewTokens): CSSProperties {
  return {
    backgroundColor: button.background,
    borderRadius: button.radius,
    color: button.color,
  };
}
