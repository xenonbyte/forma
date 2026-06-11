import type { IRElement } from "@vzi-core/renderer";
import type { PageFrame } from "./annotation-adapter.js";

/**
 * 标注属性面板(Figma Properties 风格):按选中元素类型分区显示。
 * - 布局:宽/高 + 相对所属设计稿页的 顶部/左侧
 * - 文本:内容 + 文字属性(字体/字重/字号/行高/字距/对齐) + 文字颜色
 * - 图片/图标:导出(下载原始切图/图标文件) + 预览
 * - 容器等其它:布局 + 背景色
 * 数据全部来自归档 page.vzi 解码出的元素(bounds/styles/textContent/src),
 * 不做猜测性补全 —— 样式里没有的字段不显示。
 */
export interface AnnotationSelectedElement {
  element: IRElement;
  /** 元素所属设计稿页 frame(算页内相对坐标);找不到时只展示宽高。 */
  frame: PageFrame | null;
}

export interface AnnotationPropertiesPanelProps {
  selected: AnnotationSelectedElement | null;
  t: (key: string) => string;
}

/** rgb()/rgba() → #RRGGBB(完全不透明时);其它形态原样返回展示。 */
export function cssColorToDisplay(value: string): string {
  const m = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (!m) return value.startsWith("#") ? value.toUpperCase() : value;
  const alpha = m[4] === undefined ? 1 : Number.parseFloat(m[4]);
  if (alpha < 1) return value;
  const hex = (n: string) => Number.parseInt(n, 10).toString(16).padStart(2, "0");
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`.toUpperCase();
}

function isVisibleColor(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  return !/^(transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|none)$/i.test(value.trim());
}

function styleString(styles: Record<string, unknown>, key: string): string | undefined {
  const v = styles[key];
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

/** 圆角展示值:全 0(如 "0px"、"0px 0px 0px 0px")或 none 视为无圆角,不显示。 */
export function borderRadiusDisplay(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === "none") return undefined;
  const allZero = trimmed.split("/").every((part) =>
    part
      .trim()
      .split(/\s+/)
      .every((token) => /^0(?:px|%|r?em)?$/.test(token)),
  );
  return allZero ? undefined : trimmed;
}

/** "Inter, sans-serif" → "Inter"(去引号取首字体)。 */
function firstFontFamily(value: string): string {
  return value
    .split(",")[0]
    .trim()
    .replace(/^["']|["']$/g, "");
}

function fileNameFromUrl(url: string): string {
  const last = url.split("?")[0].split("#")[0].split("/").filter(Boolean).pop();
  return last && last.length > 0 ? decodeURIComponent(last) : "asset";
}

const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/gi;

function firstBackgroundImageUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  for (const match of value.matchAll(CSS_URL_RE)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (raw.length > 0 && !/^data:/i.test(raw)) return raw;
  }
  return undefined;
}

function exportSrcFromElement(element: IRElement, styles: Record<string, unknown>): string | undefined {
  if (typeof element.src === "string" && element.src.length > 0) return element.src;
  return firstBackgroundImageUrl(styleString(styles, "backgroundImage"));
}

/** 元素展示类别:图标(svgData)优先于 image type。 */
export function elementKind(el: IRElement): "icon" | "image" | "text" | "container" | "button" | "input" | "link" {
  if (el.svgData) return "icon";
  if (typeof el.textContent === "string" && el.textContent.trim().length > 0 && el.type === "text") return "text";
  switch (el.type) {
    case "image":
      return "image";
    case "text":
      return "text";
    case "button":
      return "button";
    case "input":
      return "input";
    case "link":
      return "link";
    default:
      return "container";
  }
}

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="border-t border-zinc-200 px-4 py-3" data-testid={testId}>
      <h3 className="mb-2 text-xs font-semibold text-zinc-900">{title}</h3>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="shrink-0 text-zinc-500">{label}</span>
      <span className="truncate text-right text-zinc-800" title={value}>
        {value}
      </span>
    </div>
  );
}

function ColorRow({ value }: { value: string }) {
  const display = cssColorToDisplay(value);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        aria-hidden="true"
        className="h-4 w-4 shrink-0 rounded border border-zinc-300"
        style={{ background: value }}
      />
      <span className="truncate text-zinc-800" title={display}>
        {display}
      </span>
    </div>
  );
}

export function AnnotationPropertiesPanel({ selected, t }: AnnotationPropertiesPanelProps) {
  if (!selected) {
    return (
      <aside
        data-testid="annotation-props-panel"
        className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-zinc-200 bg-white"
      >
        <p className="px-4 py-6 text-xs text-zinc-500">{t("annotation.panel.empty")}</p>
      </aside>
    );
  }

  const { element, frame } = selected;
  const styles = (element.styles ?? {}) as Record<string, unknown>;
  const kind = elementKind(element);
  const isText = kind === "text";
  const src = exportSrcFromElement(element, styles);

  const width = Math.round(element.bounds.width);
  const height = Math.round(element.bounds.height);
  // composeAnnotationCanvas 把页面横排平移了 bounds.x;减去 frame.x 还原页内坐标。
  const left = Math.round(element.bounds.x - (frame?.x ?? 0));
  const top = Math.round(element.bounds.y);

  const radius = borderRadiusDisplay(styleString(styles, "borderRadius"));

  const fontFamily = styleString(styles, "fontFamily");
  const fontWeight = styleString(styles, "fontWeight");
  const fontStyle = styleString(styles, "fontStyle");
  const fontSize = styleString(styles, "fontSize");
  const lineHeight = styleString(styles, "lineHeight");
  const letterSpacing = styleString(styles, "letterSpacing");
  const textAlign = styleString(styles, "textAlign");
  const hasTypography = Boolean(fontFamily || fontWeight || fontSize || lineHeight || letterSpacing || textAlign);

  const textColor = isText && isVisibleColor(styles.color) ? (styles.color as string) : undefined;
  const backgroundColor =
    !isText && isVisibleColor(styles.backgroundColor) ? (styles.backgroundColor as string) : undefined;
  const colorValue = textColor ?? backgroundColor;

  return (
    <aside
      data-testid="annotation-props-panel"
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-zinc-200 bg-white"
    >
      <div className="px-4 py-3">
        <h2 data-testid="annotation-props-kind" className="truncate text-sm font-semibold text-zinc-900">
          {t(`annotation.panel.type.${kind}`)}
        </h2>
      </div>

      <Section title={t("annotation.panel.layout")} testId="annotation-props-layout">
        <Row label={t("annotation.panel.width")} value={`${width}px`} />
        <Row label={t("annotation.panel.height")} value={`${height}px`} />
        {frame ? (
          <>
            <Row label={t("annotation.panel.top")} value={`${top}px`} />
            <Row label={t("annotation.panel.left")} value={`${left}px`} />
          </>
        ) : null}
        {radius ? <Row label={t("annotation.panel.radius")} value={radius} /> : null}
      </Section>

      {isText && typeof element.textContent === "string" && element.textContent.trim().length > 0 ? (
        <Section title={t("annotation.panel.content")} testId="annotation-props-content">
          <p className="whitespace-pre-wrap break-words text-xs text-zinc-800">{element.textContent}</p>
        </Section>
      ) : null}

      {isText && hasTypography ? (
        <Section title={t("annotation.panel.typography")} testId="annotation-props-typography">
          {fontFamily ? <Row label={t("annotation.panel.font")} value={firstFontFamily(fontFamily)} /> : null}
          {fontWeight ? <Row label={t("annotation.panel.fontWeight")} value={fontWeight} /> : null}
          {fontStyle ? <Row label={t("annotation.panel.fontStyle")} value={fontStyle} /> : null}
          {fontSize ? <Row label={t("annotation.panel.fontSize")} value={fontSize} /> : null}
          {lineHeight ? <Row label={t("annotation.panel.lineHeight")} value={lineHeight} /> : null}
          {letterSpacing ? <Row label={t("annotation.panel.letterSpacing")} value={letterSpacing} /> : null}
          {textAlign ? <Row label={t("annotation.panel.textAlign")} value={textAlign} /> : null}
        </Section>
      ) : null}

      {colorValue ? (
        <Section title={t("annotation.panel.colors")} testId="annotation-props-colors">
          <ColorRow value={colorValue} />
        </Section>
      ) : null}

      {src ? (
        <Section title={t("annotation.panel.export")} testId="annotation-props-export">
          <a
            data-testid="annotation-props-download"
            href={src}
            download={fileNameFromUrl(src)}
            className="block rounded border border-zinc-300 px-3 py-1.5 text-center text-xs font-medium text-zinc-800 hover:bg-zinc-50"
          >
            {t("annotation.panel.download")}
          </a>
          <p className="mt-1 text-xs text-zinc-500">{t("annotation.panel.preview")}</p>
          <img
            data-testid="annotation-props-preview"
            src={src}
            alt=""
            className="max-h-48 w-full rounded border border-zinc-200 bg-zinc-50 object-contain"
          />
        </Section>
      ) : null}
    </aside>
  );
}
