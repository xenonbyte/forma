import type { Annotation, VZIContent } from '@vzi-core/format';
import type { IRElement, IRStyles } from '@vzi-core/types';
import {
  type McpAsset,
  type McpAnnotationsOutput,
  type McpElementDetail,
  type McpElementEntries,
  type McpElementList,
  type McpElementNode,
  type McpOverview,
  type McpQueryOptions,
  type McpResponsiveSnapshot,
  type McpSearchResult,
  type McpSourceSummary,
  type McpTokensOutput,
  type McpUiHints,
} from './types';
import { stylesToCss } from './style-to-css';
import { extractColorVars, extractFontVars, extractGlobalVars } from './global-vars-extractor';

type BreakpointKey = 'sm' | 'md' | 'lg' | 'xl' | '2xl';
type StateKey = 'hover' | 'focus' | 'active';

const BREAKPOINT_KEYS: BreakpointKey[] = ['sm', 'md', 'lg', 'xl', '2xl'];
const STATE_KEYS: StateKey[] = ['hover', 'focus', 'active'];

const STYLE_PIXEL_PROPERTIES = new Set([
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'top', 'right', 'bottom', 'left',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderWidth', 'borderRadius',
  'fontSize', 'lineHeight', 'letterSpacing',
  'gap', 'rowGap', 'columnGap',
  'gridGap',
]);

const TAILWIND_MAX_WIDTH: Record<string, string> = {
  none: 'none',
  xs: '20rem',
  sm: '24rem',
  md: '28rem',
  lg: '32rem',
  xl: '36rem',
  '2xl': '42rem',
  '3xl': '48rem',
  '4xl': '56rem',
  '5xl': '64rem',
  '6xl': '72rem',
  '7xl': '80rem',
  full: '100%',
  prose: '65ch',
};

const TAILWIND_TRACKING: Record<string, string> = {
  tighter: '-0.05em',
  tight: '-0.025em',
  normal: '0',
  wide: '0.025em',
  wider: '0.05em',
  widest: '0.1em',
};

const TAILWIND_OBJECT_FIT: Record<string, string> = {
  contain: 'contain',
  cover: 'cover',
  fill: 'fill',
  none: 'none',
  'scale-down': 'scale-down',
};

const TAILWIND_OBJECT_POSITION: Record<string, string> = {
  center: 'center',
  top: 'top',
  bottom: 'bottom',
  left: 'left',
  right: 'right',
  'left-top': 'left top',
  'left-bottom': 'left bottom',
  'right-top': 'right top',
  'right-bottom': 'right bottom',
};

const TAILWIND_ANIMATION: Record<string, string> = {
  pulse: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
  spin: 'spin 1s linear infinite',
  ping: 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite',
  bounce: 'bounce 1s infinite',
};

const INHERITABLE_STYLE_KEYS = [
  'color',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'whiteSpace',
  'textTransform',
] as const;

function normalizeString(value: string | undefined | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeSpacingValue(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value === 0) return undefined;
    return `${value}px`;
  }

  const normalized = value.trim();
  if (!normalized) return undefined;
  if (
    normalized === 'normal' ||
    normalized === 'none' ||
    normalized === 'auto' ||
    normalized === '0' ||
    normalized === '0px'
  ) {
    return undefined;
  }

  if (/^-?\d+(\.\d+)?$/.test(normalized)) {
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric) || numeric === 0) return undefined;
    return `${numeric}px`;
  }

  return normalized;
}

function normalizeStyleValue(property: string, value: string | number): string {
  if (typeof value === 'number') {
    if (value === 0) return '0';
    if (STYLE_PIXEL_PROPERTIES.has(property)) return `${value}px`;
    return String(value);
  }

  const normalized = value.trim();
  if (!normalized) return normalized;
  if (/^-?\d+(\.\d+)?$/.test(normalized) && STYLE_PIXEL_PROPERTIES.has(property)) {
    const numeric = Number(normalized);
    if (Number.isFinite(numeric)) {
      return numeric === 0 ? '0' : `${numeric}px`;
    }
  }
  return normalized;
}

function normalizeComparable(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isTransparentColor(value: string): boolean {
  const normalized = normalizeComparable(value);
  return (
    normalized === 'transparent' ||
    normalized === 'rgba(0, 0, 0, 0)' ||
    normalized === 'rgba(0,0,0,0)' ||
    normalized === 'rgba(255, 255, 255, 0)' ||
    normalized === 'rgba(255,255,255,0)'
  );
}

function isZeroLike(value: string): boolean {
  const normalized = normalizeComparable(value);
  return normalized === '0' || normalized === '0px' || normalized === '0%' || normalized === '0rem';
}

type ClassVariantInfo = {
  base: string[];
  state: Record<StateKey, string[]>;
  breakpoint: Record<BreakpointKey, string[]>;
};

function createEmptyVariantInfo(): ClassVariantInfo {
  return {
    base: [],
    state: {
      hover: [],
      focus: [],
      active: [],
    },
    breakpoint: {
      sm: [],
      md: [],
      lg: [],
      xl: [],
      '2xl': [],
    },
  };
}

function splitClassTokens(className?: string): string[] {
  if (!className) return [];
  return className
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function extractClassVariants(className?: string): ClassVariantInfo {
  const info = createEmptyVariantInfo();
  const tokens = splitClassTokens(className);

  for (const token of tokens) {
    const parts = token.split(':');
    if (parts.length === 1) {
      info.base.push(parts[0]);
      continue;
    }

    const rawClass = parts[parts.length - 1];
    let stateKey: StateKey | undefined;
    let breakpointKey: BreakpointKey | undefined;

    for (let i = 0; i < parts.length - 1; i++) {
      const prefix = parts[i];
      if (STATE_KEYS.includes(prefix as StateKey)) {
        stateKey = prefix as StateKey;
      }
      if (BREAKPOINT_KEYS.includes(prefix as BreakpointKey)) {
        breakpointKey = prefix as BreakpointKey;
      }
    }

    if (!stateKey && !breakpointKey) {
      info.base.push(rawClass);
      continue;
    }

    if (stateKey) {
      info.state[stateKey].push(rawClass);
    }
    if (breakpointKey) {
      info.breakpoint[breakpointKey].push(rawClass);
    }
  }

  return info;
}

function hasStateClasses(value: McpSourceSummary['stateClasses'] | undefined): boolean {
  if (!value) return false;
  return (
    (value.hover?.length || 0) > 0 ||
    (value.focus?.length || 0) > 0 ||
    (value.active?.length || 0) > 0
  );
}

function extractStateClasses(className?: string): McpSourceSummary['stateClasses'] | undefined {
  const variants = extractClassVariants(className);
  const stateClasses: McpSourceSummary['stateClasses'] = {};
  for (const key of STATE_KEYS) {
    const classes = variants.state[key];
    if (classes.length > 0) {
      stateClasses[key] = Array.from(new Set(classes));
    }
  }
  return hasStateClasses(stateClasses) ? stateClasses : undefined;
}

function parseBracketValue(value: string): string | undefined {
  const match = value.match(/^\[(.+)\]$/);
  if (!match) return undefined;
  return match[1];
}

function inferStylesFromClassName(className?: string): IRStyles {
  const variants = extractClassVariants(className);
  const inferred: IRStyles = {};

  for (const token of variants.base) {
    if (token.startsWith('max-w-')) {
      const raw = token.slice('max-w-'.length);
      const arbitrary = parseBracketValue(raw);
      if (arbitrary) {
        inferred.maxWidth = arbitrary;
      } else if (TAILWIND_MAX_WIDTH[raw]) {
        inferred.maxWidth = TAILWIND_MAX_WIDTH[raw];
      }
      continue;
    }

    if (token.startsWith('tracking-')) {
      const raw = token.slice('tracking-'.length);
      if (TAILWIND_TRACKING[raw]) {
        inferred.letterSpacing = TAILWIND_TRACKING[raw];
      }
      continue;
    }

    if (token.startsWith('object-')) {
      const raw = token.slice('object-'.length);
      if (TAILWIND_OBJECT_FIT[raw]) {
        inferred.objectFit = TAILWIND_OBJECT_FIT[raw];
      } else if (TAILWIND_OBJECT_POSITION[raw]) {
        inferred.objectPosition = TAILWIND_OBJECT_POSITION[raw];
      }
      continue;
    }

    if (token.startsWith('animate-')) {
      const raw = token.slice('animate-'.length);
      if (TAILWIND_ANIMATION[raw]) {
        inferred.animation = TAILWIND_ANIMATION[raw];
      }
      continue;
    }
  }

  return inferred;
}

function shouldDropStyle(property: string, value: string, normalizedStyles: Record<string, string>): boolean {
  const normalized = normalizeComparable(value);
  const position = normalizeComparable(normalizedStyles.position || '');
  const display = normalizeComparable(normalizedStyles.display || '');
  const isFlexOrGrid = display === 'flex' || display === 'inline-flex' || display === 'grid' || display === 'inline-grid';

  if (normalized.length === 0) return true;

  switch (property) {
    case 'display':
      return normalized === 'block' || normalized === 'inline';
    case 'position':
      return normalized === 'static';
    case 'top':
    case 'right':
    case 'bottom':
    case 'left':
      return position === 'static' || normalized === 'auto' || isZeroLike(normalized);
    case 'width':
    case 'height':
      return normalized === 'auto';
    case 'margin':
    case 'padding':
    case 'borderWidth':
    case 'borderRadius':
    case 'gap':
    case 'rowGap':
    case 'columnGap':
      return isZeroLike(normalized) || normalized === 'normal';
    case 'border':
      return normalized.startsWith('0px ') || normalized === 'none' || normalized === '0';
    case 'borderStyle':
      return normalized === 'none' || isZeroLike(normalizedStyles.borderWidth || '0');
    case 'borderColor':
      return isTransparentColor(normalized) || isZeroLike(normalizedStyles.borderWidth || '0');
    case 'backgroundColor':
      return isTransparentColor(normalized);
    case 'opacity':
      return normalized === '1';
    case 'zIndex':
      return normalized === 'auto' || normalized === '0';
    case 'overflow':
      return normalized === 'visible';
    case 'whiteSpace':
      return normalized === 'normal';
    case 'textTransform':
      return normalized === 'none';
    case 'flexDirection':
      return !isFlexOrGrid || normalized === 'row' || normalized === 'normal';
    case 'justifyContent':
      return !isFlexOrGrid || normalized === 'normal' || normalized === 'flex-start' || normalized === 'start';
    case 'alignItems':
      return !isFlexOrGrid || normalized === 'normal' || normalized === 'stretch';
    case 'boxShadow':
    case 'transform':
    case 'filter':
    case 'backdropFilter':
    case 'backgroundImage':
      return normalized === 'none';
    case 'backgroundRepeat':
      return normalized === 'repeat';
    case 'backgroundPosition':
      return normalized === '0% 0%' || normalized === 'left top';
    case 'backgroundSize':
      return normalized === 'auto' || normalized === 'auto auto';
    case 'backgroundClip':
      return normalized === 'border-box';
    case 'backgroundOrigin':
      return normalized === 'padding-box';
    default:
      return false;
  }
}

function normalizeStyles(styles: IRStyles, className?: string): IRStyles {
  const inferred = inferStylesFromClassName(className);
  const merged: IRStyles = {
    ...styles,
  };

  for (const [property, value] of Object.entries(inferred)) {
    if (value === undefined || value === null || value === '') continue;
    if (merged[property] === undefined || merged[property] === null || merged[property] === '') {
      merged[property] = value;
    }
  }

  const normalizedMap: Record<string, string> = {};
  for (const [property, value] of Object.entries(merged)) {
    if (value === undefined || value === null || value === '') continue;
    normalizedMap[property] = normalizeStyleValue(property, value as string | number);
  }

  const normalized: IRStyles = {};
  for (const [property, value] of Object.entries(normalizedMap)) {
    if (shouldDropStyle(property, value, normalizedMap)) {
      continue;
    }
    normalized[property] = value;
  }

  return normalized;
}

function classifyLandmark(tagName?: string, role?: string): McpSourceSummary['landmark'] {
  const tag = (tagName || '').toLowerCase();
  const normalizedRole = (role || '').toLowerCase();
  if (tag === 'header' || normalizedRole === 'banner') return 'header';
  if (tag === 'main' || normalizedRole === 'main') return 'main';
  if (tag === 'footer' || normalizedRole === 'contentinfo') return 'footer';
  if (tag === 'nav' || normalizedRole === 'navigation') return 'navigation';
  if (tag === 'section' || normalizedRole === 'region') return 'section';
  if (tag === 'aside' || normalizedRole === 'complementary') return 'aside';
  return 'none';
}

function inferRole(element: IRElement): string | undefined {
  const explicit = normalizeString(element.source?.role);
  if (explicit) return explicit;

  const tagName = (element.source?.tagName || '').toLowerCase();
  if (tagName === 'a') return 'link';
  if (tagName === 'button') return 'button';
  if (tagName === 'article') return 'article';
  if (tagName === 'form') return 'form';
  if (tagName === 'input') return 'textbox';
  if (tagName === 'label') return 'label';
  if (tagName === 'table') return 'table';
  if (tagName === 'thead') return 'rowgroup';
  if (tagName === 'tbody') return 'rowgroup';
  if (tagName === 'tr') return 'row';
  if (tagName === 'td') return 'cell';
  if (tagName === 'th') return 'columnheader';
  if (tagName === 'svg') return 'img';
  if (tagName === 'nav') return 'navigation';
  if (tagName === 'main') return 'main';
  if (tagName === 'header') return 'banner';
  if (tagName === 'footer') return 'contentinfo';
  if (tagName === 'section') return 'region';
  if (tagName === 'aside') return 'complementary';
  if (tagName === 'img') return 'img';
  if (tagName === 'p') return 'paragraph';
  if (tagName === 'span') return 'text';
  if (tagName === 'div') return 'group';
  if (tagName === 'ul' || tagName === 'ol') return 'list';
  if (tagName === 'li') return 'listitem';
  if (/^h[1-6]$/.test(tagName)) return 'heading';
  if (element.type === 'button') return 'button';
  if (element.type === 'image') return 'img';
  if (element.type === 'text') return 'text';
  if (element.type === 'container') return 'group';
  return undefined;
}

function inferTargetRouteFromText(name: string | undefined, className: string | undefined): string | undefined {
  const text = `${name || ''} ${className || ''}`.toLowerCase();
  if (!text) return undefined;

  if (/login|sign\s?in|登录/.test(text)) return '/auth/login';
  if (/register|sign\s?up|start|免费|注册|开始|立即/.test(text)) return '/auth/register';
  if (/feature|功能|能力/.test(text)) return '#features';
  if (/pricing|price|plan|价格|套餐/.test(text)) return '#pricing';
  if (/doc|文档|api/.test(text)) return '#docs';
  if (/community|社区/.test(text)) return '#community';
  if (/contact|sales|联系/.test(text)) return '#contact';
  return undefined;
}

function classifyImportance(
  tagName?: string,
  role?: string,
  className?: string,
  name?: string
): McpSourceSummary['importance'] {
  const cls = (className || '').toLowerCase();
  const normalizedRole = (role || '').toLowerCase();
  const lowerTag = (tagName || '').toLowerCase();
  const text = (name || '').toLowerCase();

  if (
    lowerTag === 'h1' ||
    cls.includes('hero') ||
    cls.includes('headline') ||
    cls.includes('primary') ||
    /start|register|立即|开始|free/.test(text) ||
    normalizedRole === 'main'
  ) {
    return 'high';
  }

  if (
    lowerTag === 'h2' ||
    lowerTag === 'h3' ||
    lowerTag === 'button' ||
    lowerTag === 'a' ||
    lowerTag === 'nav' ||
    normalizedRole === 'button' ||
    normalizedRole === 'link'
  ) {
    return 'medium';
  }

  return 'low';
}

function inferInteraction(
  element: IRElement,
  resolvedName?: string
): Pick<McpSourceSummary, 'intent' | 'actionType' | 'targetRoute'> {
  const href = normalizeString(element.source?.href);
  const className = normalizeString(element.source?.className);
  const tagName = (element.source?.tagName || '').toLowerCase();
  const text = `${resolvedName || ''} ${className || ''}`.toLowerCase();

  if (href) {
    const inferredRoute = href === '#'
      ? inferTargetRouteFromText(resolvedName, className) || '#'
      : href;
    return {
      intent: 'navigate',
      actionType: 'link',
      targetRoute: inferredRoute,
    };
  }

  if (tagName === 'button' || element.type === 'button') {
    if (/download|下载/.test(text)) {
      return { intent: 'download', actionType: 'button' };
    }
    const inferredRoute = inferTargetRouteFromText(resolvedName, className);
    if (inferredRoute) {
      return { intent: 'navigate', actionType: 'button', targetRoute: inferredRoute };
    }
    if (/open|view|detail|docs|文档|查看|详情/.test(text)) {
      return { intent: 'open', actionType: 'button' };
    }
    return { intent: 'open', actionType: 'button' };
  }

  return { intent: 'none', actionType: 'none' };
}

function inferComponentRole(
  element: IRElement,
  resolvedName: string | undefined,
  targetRoute: string | undefined
): McpSourceSummary['componentRole'] {
  const tagName = (element.source?.tagName || '').toLowerCase();
  const className = (element.source?.className || '').toLowerCase();
  const text = `${resolvedName || ''} ${className}`.toLowerCase();

  if (element.type === 'image' || tagName === 'img') return 'media';
  if (element.type === 'container') return 'container';

  if (tagName === 'a' || element.type === 'link') {
    if (/register|sign\s?up|start|立即|开始|订阅/.test(text) || targetRoute === '/auth/register') {
      return 'primary-cta';
    }
    return 'nav-link';
  }

  if (tagName === 'button' || element.type === 'button') {
    if (/primary|cta|register|start|subscribe|立即|开始|订阅/.test(text) || targetRoute === '/auth/register') {
      return 'primary-cta';
    }
    return 'secondary-cta';
  }

  if (element.type === 'text') return 'body-text';
  return 'other';
}

function hashStable(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36);
}

function isDataUrl(uri: string): boolean {
  return /^data:/i.test(uri);
}

function isHttpUrl(uri: string): boolean {
  return /^https?:\/\//i.test(uri);
}

function inferExtensionFromUri(uri: string): string | undefined {
  if (isDataUrl(uri)) {
    const mime = uri.match(/^data:([^;,]+)/i)?.[1];
    if (!mime) return undefined;
    const extension = mime.split('/')[1];
    return extension ? extension.toLowerCase() : undefined;
  }

  try {
    const parsed = new URL(uri, 'https://local.invalid');
    const pathname = parsed.pathname || '';
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    return match?.[1]?.toLowerCase();
  } catch {
    return undefined;
  }
}

function inferMimeTypeFromUri(uri: string): string | undefined {
  if (isDataUrl(uri)) {
    return uri.match(/^data:([^;,]+)/i)?.[1];
  }

  const extension = inferExtensionFromUri(uri);
  if (!extension) return undefined;
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'svg') return 'image/svg+xml';
  return undefined;
}

function normalizeAssetUri(uri: string): string | undefined {
  if (!uri) return undefined;
  if (isDataUrl(uri)) {
    const match = uri.match(/^data:([^;,]+)/i);
    return match ? `data:${match[1]};base64,[omitted]` : 'data:[omitted]';
  }
  return uri;
}

function inferAssetType(uri: string, className?: string): McpAsset['type'] {
  const cls = (className || '').toLowerCase();
  if (cls.includes('icon') || cls.includes('symbol')) return 'icon';
  if (/\.(png|jpg|jpeg|webp|gif|svg)(\?|$)/i.test(uri) || isDataUrl(uri)) return 'image';
  return 'other';
}

function viewportLabel(width: number): McpResponsiveSnapshot['label'] {
  if (width < 768) return 'mobile';
  if (width <= 1024) return 'tablet';
  return 'desktop';
}

function scaledHeight(sourceWidth: number, sourceHeight: number, targetWidth: number): number {
  if (!Number.isFinite(sourceWidth) || sourceWidth <= 0) return sourceHeight;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0) return sourceHeight;
  const scaled = Math.round((sourceHeight * targetWidth) / sourceWidth);
  return Math.max(1, scaled);
}

export class McpQuery {
  private readonly content: VZIContent;
  private readonly options: McpQueryOptions;
  private readonly cssCache: Map<string, string>;
  private readonly normalizedStyleCache: Map<string, IRStyles>;
  private readonly outputStyleCache: Map<string, IRStyles>;
  private readonly elementEntries: McpElementEntries;
  private readonly childrenByParent = new Map<string, string[]>();
  private readonly depthById = new Map<string, number>();
  private readonly pathById = new Map<string, string[]>();
  private readonly orderById = new Map<string, number>();
  private readonly stableIdById = new Map<string, string>();
  private readonly assetIdByUri = new Map<string, string>();
  private readonly assetCatalog: McpAsset[] = [];
  private readonly breakpointUsage: Record<BreakpointKey, number> = {
    sm: 0,
    md: 0,
    lg: 0,
    xl: 0,
    '2xl': 0,
  };

  constructor(content: VZIContent, options: Partial<McpQueryOptions> = {}) {
    this.content = content;
    this.options = {
      format: options.format || 'json',
      depth: options.depth,
      typeFilter: options.typeFilter,
      includeCss: options.includeCss !== false,
    };
    this.cssCache = new Map();
    this.normalizedStyleCache = new Map();
    this.outputStyleCache = new Map();
    this.elementEntries = Array.from(this.content.elements.entries());
    this.buildElementIndexes();
    this.collectBreakpointUsage();
    this.buildAssetCatalog();
  }

  private getNormalizedStyles(elementId: string, styles: IRStyles, className?: string): IRStyles {
    const cached = this.normalizedStyleCache.get(elementId);
    if (cached) {
      return cached;
    }
    const normalized = normalizeStyles(styles, className);
    this.normalizedStyleCache.set(elementId, normalized);
    return normalized;
  }

  private getOutputStyles(elementId: string, element: IRElement): IRStyles {
    const cached = this.outputStyleCache.get(elementId);
    if (cached) {
      return cached;
    }

    const normalized = this.getNormalizedStyles(elementId, element.styles, element.source?.className);
    const output: IRStyles = { ...normalized };
    const parentId = element.parentId;
    if (parentId && this.content.elements.has(parentId)) {
      const parentElement = this.content.elements.get(parentId);
      if (parentElement) {
        const parentStyles = this.getOutputStyles(parentId, parentElement);
        for (const key of INHERITABLE_STYLE_KEYS) {
          const current = output[key];
          const parent = parentStyles[key];
          if (typeof current !== 'string' || typeof parent !== 'string') {
            continue;
          }
          if (normalizeComparable(current) === normalizeComparable(parent)) {
            delete output[key];
          }
        }
      }
    }

    this.outputStyleCache.set(elementId, output);
    return output;
  }

  private getCss(elementId: string, element: IRElement): string {
    if (!this.options.includeCss) return '';

    let css = this.cssCache.get(elementId);
    if (!css) {
      css = stylesToCss(this.getOutputStyles(elementId, element));
      this.cssCache.set(elementId, css);
    }
    return css;
  }

  private inferElementName(elementId: string, element: IRElement): string | undefined {
    const explicitName = normalizeString(element.source?.name);
    if (explicitName) return explicitName;

    const textContent = normalizeString(element.textContent);
    if (textContent) return textContent;

    const descendants = this.getChildren(elementId, 2).slice(0, 24);
    for (const descendantId of descendants) {
      const child = this.content.elements.get(descendantId);
      if (!child) continue;
      const childText = normalizeString(child.textContent) ?? normalizeString(child.source?.name);
      if (childText) return childText;
    }

    return undefined;
  }

  private getSourceSummary(elementId: string, element: IRElement): McpSourceSummary | undefined {
    if (!element.source) return undefined;

    const role = inferRole(element);
    const name = this.inferElementName(elementId, element);
    const interaction = inferInteraction(element, name);
    const rawHref = normalizeString(element.source.href);
    const resolvedHref = rawHref === '#' && interaction.targetRoute
      ? interaction.targetRoute
      : rawHref;
    const sourceUri = element.source.src || element.source.href;
    const stateClasses = extractStateClasses(element.source.className);

    return {
      tagName: element.source.tagName,
      className: element.source.className,
      id: element.source.id,
      role,
      name,
      href: resolvedHref,
      rawHref: rawHref && rawHref !== resolvedHref ? rawHref : undefined,
      src: element.source.src,
      alt: element.source.alt,
      target: element.source.target,
      rel: element.source.rel,
      landmark: classifyLandmark(element.source.tagName, role),
      componentRole: inferComponentRole(element, name, interaction.targetRoute),
      intent: interaction.intent,
      actionType: interaction.actionType,
      targetRoute: interaction.targetRoute,
      importance: classifyImportance(element.source.tagName, role, element.source.className, name),
      assetId: sourceUri ? this.assetIdByUri.get(sourceUri) : undefined,
      stateClasses,
    };
  }

  private buildElementIndexes(): void {
    const rootIds: string[] = [];

    this.elementEntries.forEach(([id], index) => {
      this.orderById.set(id, index);
    });

    for (const [id, element] of this.elementEntries) {
      const parentId = element.parentId;
      if (parentId && this.content.elements.has(parentId)) {
        const children = this.childrenByParent.get(parentId);
        if (children) {
          children.push(id);
        } else {
          this.childrenByParent.set(parentId, [id]);
        }
      } else {
        rootIds.push(id);
      }
    }

    const queue: Array<{ id: string; depth: number; path: string[] }> = rootIds.map((id) => ({
      id,
      depth: 0,
      path: [id],
    }));
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      if (visited.has(current.id)) continue;
      visited.add(current.id);

      this.depthById.set(current.id, current.depth);
      this.pathById.set(current.id, current.path);

      const children = this.childrenByParent.get(current.id) || [];
      for (const childId of children) {
        queue.push({
          id: childId,
          depth: current.depth + 1,
          path: [...current.path, childId],
        });
      }
    }

    for (const [id] of this.elementEntries) {
      if (!this.depthById.has(id)) {
        this.depthById.set(id, 0);
      }
      if (!this.pathById.has(id)) {
        this.pathById.set(id, [id]);
      }
    }

    for (const [id, element] of this.elementEntries) {
      const path = this.pathById.get(id) || [id];
      const stableSeed = this.getStableSeed(id, element, path);
      this.stableIdById.set(id, `sid_${hashStable(stableSeed)}`);
    }
  }

  private collectBreakpointUsage(): void {
    for (const [, element] of this.elementEntries) {
      const className = element.source?.className;
      if (!className) continue;
      const variants = extractClassVariants(className);
      for (const key of BREAKPOINT_KEYS) {
        this.breakpointUsage[key] += variants.breakpoint[key].length;
      }
    }
  }

  private getStableSeed(id: string, element: IRElement, path: string[]): string {
    const pathTagChain = path
      .map((pathId) => this.content.elements.get(pathId)?.source?.tagName || this.content.elements.get(pathId)?.type || pathId)
      .join('/');
    const source = element.source;
    const textSample = (element.textContent || source?.name || '').trim().slice(0, 32);
    return [
      pathTagChain,
      source?.tagName || '',
      source?.id || '',
      source?.className || '',
      source?.href || '',
      source?.src || '',
      textSample,
      this.orderById.get(id) ?? 0,
    ].join('|');
  }

  private buildAssetCatalog(): void {
    const assetMap = new Map<string, McpAsset>();

    const ensureAsset = (uri: string, element: IRElement) => {
      const rawUri = uri.trim();
      if (!rawUri) return;

      const width = Number.isFinite(element.bounds.width) && element.bounds.width > 0
        ? Math.round(element.bounds.width)
        : undefined;
      const height = Number.isFinite(element.bounds.height) && element.bounds.height > 0
        ? Math.round(element.bounds.height)
        : undefined;

      let asset = assetMap.get(rawUri);
      if (!asset) {
        const sanitizedUri = normalizeAssetUri(rawUri) || rawUri;
        const id = `asset_${hashStable(rawUri).slice(0, 10)}`;
        const source: McpAsset['source'] = isHttpUrl(rawUri)
          ? 'url'
          : isDataUrl(rawUri)
            ? 'data-url'
            : 'unknown';

        asset = {
          id,
          type: inferAssetType(rawUri, element.source?.className),
          mimeType: inferMimeTypeFromUri(rawUri),
          extension: inferExtensionFromUri(rawUri),
          source,
          uri: sanitizedUri,
          rawUri: sanitizedUri === rawUri ? undefined : rawUri,
          normalizedUri: sanitizedUri,
          width,
          height,
          references: [],
        };

        assetMap.set(rawUri, asset);
      } else {
        if (!asset.width && width) {
          asset.width = width;
        }
        if (!asset.height && height) {
          asset.height = height;
        }
      }

      if (!asset.references.includes(element.id)) {
        asset.references.push(element.id);
      }

      this.assetIdByUri.set(rawUri, asset.id);
      this.assetIdByUri.set(asset.uri, asset.id);
      if (asset.normalizedUri) {
        this.assetIdByUri.set(asset.normalizedUri, asset.id);
      }
    };

    const backgroundUrlRegex = /url\((['"]?)(.*?)\1\)/gi;

    for (const [, element] of this.elementEntries) {
      const src = element.source?.src;
      if (typeof src === 'string') {
        ensureAsset(src, element);
      }

      const backgroundImage = element.styles.backgroundImage;
      if (typeof backgroundImage === 'string') {
        let match: RegExpExecArray | null;
        while ((match = backgroundUrlRegex.exec(backgroundImage)) !== null) {
          const uri = match[2]?.trim();
          if (uri) {
            ensureAsset(uri, element);
          }
        }
      }
    }

    this.assetCatalog.push(...Array.from(assetMap.values()));
  }

  overview(): McpOverview {
    const elementCount = this.content.elements.size;
    const complexity = elementCount < 20 ? 'simple' : elementCount < 100 ? 'medium' : 'complex';

    return {
      title: this.content.metadata.name,
      canvasSize: {
        width: this.content.metadata.viewportWidth,
        height: this.content.metadata.viewportHeight,
      },
      elementCount,
      complexity,
      version: this.content.metadata.minReaderVersion,
      createdAt: this.content.metadata.createdAt,
      hasErrors: false,
      errorCount: 0,
    };
  }

  listElements(typeFilter?: string): McpElementList {
    let elements = [...this.elementEntries];

    if (typeFilter || this.options.typeFilter) {
      const filterType = typeFilter || this.options.typeFilter;
      elements = elements.filter(([, el]) => el.type === filterType);
    }

    if (this.options.depth !== undefined) {
      elements = this.applyDepthLimit(elements, this.options.depth);
    }

    const elementNodes = elements.map(([id, el]) => ({
      id,
      stableId: this.stableIdById.get(id),
      type: el.type,
      bounds: el.bounds,
      css: this.getCss(id, el),
      textContent: el.textContent,
      path: this.pathById.get(id),
      depth: this.depthById.get(id),
      order: this.orderById.get(id),
      source: this.getSourceSummary(id, el),
    }));

    return {
      elements: elementNodes,
      total: elementNodes.length,
      filteredBy: typeFilter || this.options.typeFilter,
    };
  }

  getElement(elementId: string, depth?: number): McpElementDetail | null {
    const element = this.content.elements.get(elementId);
    if (!element) return null;

    const maxDepth = depth !== undefined ? depth : (this.options.depth ?? 10);
    const children = this.getChildren(elementId, maxDepth);

    return {
      id: element.id,
      stableId: this.stableIdById.get(elementId),
      type: element.type,
      bounds: element.bounds,
      css: this.getCss(elementId, element),
      styles: this.getOutputStyles(elementId, element),
      textContent: element.textContent,
      parentId: element.parentId,
      children,
      path: this.pathById.get(elementId),
      depth: this.depthById.get(elementId),
      order: this.orderById.get(elementId),
      source: this.getSourceSummary(elementId, element),
    };
  }

  searchElements(query: string, type?: string): McpSearchResult {
    const keyword = query.trim().toLowerCase();
    const results: McpSearchResult['elements'] = [];

    for (const [id, element] of this.elementEntries) {
      if (type && element.type !== type) {
        continue;
      }

      const resolvedName = this.inferElementName(id, element);
      const searchableParts = [
        id,
        element.type,
        element.textContent || '',
        resolvedName || '',
        element.source?.tagName || '',
        element.source?.className || '',
        element.source?.id || '',
      ];

      const searchableText = searchableParts.join(' ').toLowerCase();
      if (!searchableText.includes(keyword)) {
        continue;
      }

      results.push({
        id,
        stableId: this.stableIdById.get(id),
        type: element.type,
        bounds: element.bounds,
        textContent: element.textContent,
        css: this.getCss(id, element),
        path: this.pathById.get(id),
        depth: this.depthById.get(id),
        order: this.orderById.get(id),
        source: this.getSourceSummary(id, element),
      });
    }

    return {
      query,
      type: type || null,
      elements: results,
      total: results.length,
    };
  }

  getTokens(type?: 'colors' | 'fonts' | 'all'): McpTokensOutput {
    const elements = this.elementEntries.map(([id, el]) => ({
      id,
      styles: this.getNormalizedStyles(id, el.styles, el.source?.className),
    }));

    const result: McpTokensOutput = {
      elementCount: this.content.elements.size,
    };

    if (!type || type === 'all') {
      const { tokens } = extractGlobalVars(elements);
      result.colors = tokens.colors;
      result.fonts = tokens.fonts;
      result.spacing = tokens.spacing;
      result.radii = tokens.radii;
      result.shadows = tokens.shadows;
      result.gradients = tokens.gradients;
      return result;
    }

    if (type === 'colors') {
      result.colors = extractColorVars(elements);
    }

    if (type === 'fonts') {
      result.fonts = extractFontVars(elements);
    }

    return result;
  }

  getAnnotations(elementId?: string): McpAnnotationsOutput {
    const annotations = Array.isArray(this.content.annotations) ? this.content.annotations : [];
    const rawAnnotations = elementId
      ? annotations.filter((annotation) => annotation.elementIds.includes(elementId))
      : annotations;

    const styleHints = this.collectStyleHints(elementId);

    return {
      annotations: rawAnnotations,
      styleHints,
      spacingSummary: {
        marginCount: styleHints.filter((hint) => Boolean(hint.margin)).length,
        paddingCount: styleHints.filter((hint) => Boolean(hint.padding)).length,
        gapCount: styleHints.filter((hint) => Boolean(hint.gap)).length,
        rowGapCount: styleHints.filter((hint) => Boolean(hint.rowGap)).length,
        columnGapCount: styleHints.filter((hint) => Boolean(hint.columnGap)).length,
      },
      elementId: elementId || null,
      total: rawAnnotations.length,
    };
  }

  getUiHints(): McpUiHints {
    const childrenByParent: Record<string, string[]> = {};
    this.childrenByParent.forEach((children, parentId) => {
      childrenByParent[parentId] = [...children];
    });

    const depthById: Record<string, number> = {};
    this.depthById.forEach((depth, id) => {
      depthById[id] = depth;
    });

    const pathById: Record<string, string[]> = {};
    this.pathById.forEach((path, id) => {
      pathById[id] = [...path];
    });

    const stableIdById: Record<string, string> = {};
    this.stableIdById.forEach((stableId, id) => {
      stableIdById[id] = stableId;
    });

    return {
      order: this.elementEntries.map(([id]) => id),
      childrenByParent,
      depthById,
      pathById,
      stableIdById,
    };
  }

  getAssets(): McpAsset[] {
    return this.assetCatalog.map((asset) => ({
      ...asset,
      references: [...asset.references],
    }));
  }

  getResponsiveSnapshots(): McpResponsiveSnapshot[] {
    const width = this.content.metadata.viewportWidth;
    const height = this.content.metadata.viewportHeight;
    const snapshots: McpResponsiveSnapshot[] = [];
    const seenIds = new Set<string>();

    const addSnapshot = (
      viewportWidth: number,
      label: McpResponsiveSnapshot['label'],
      derivedFrom: McpResponsiveSnapshot['derivedFrom'],
      breakpoint?: McpResponsiveSnapshot['breakpoint']
    ) => {
      if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
        return;
      }
      const viewportHeight = scaledHeight(width, height, viewportWidth);
      const id = `viewport-${viewportWidth}x${viewportHeight}`;
      if (seenIds.has(id)) {
        return;
      }
      seenIds.add(id);
      snapshots.push({
        id,
        label,
        viewportWidth,
        viewportHeight,
        derivedFrom,
        breakpoint,
      });
    };

    addSnapshot(width, viewportLabel(width), 'source-viewport');

    const hasResponsiveClasses = BREAKPOINT_KEYS.some((key) => this.breakpointUsage[key] > 0);
    if (!hasResponsiveClasses) {
      return snapshots;
    }

    if (this.breakpointUsage.sm > 0 || this.breakpointUsage.md > 0 || this.breakpointUsage.lg > 0 || this.breakpointUsage.xl > 0 || this.breakpointUsage['2xl'] > 0) {
      addSnapshot(375, 'mobile', 'breakpoint-class', 'sm');
    }

    if (this.breakpointUsage.md > 0 || this.breakpointUsage.lg > 0 || this.breakpointUsage.xl > 0 || this.breakpointUsage['2xl'] > 0) {
      addSnapshot(768, 'tablet', 'breakpoint-class', 'md');
    }

    if (this.breakpointUsage.lg > 0 || this.breakpointUsage.xl > 0 || this.breakpointUsage['2xl'] > 0) {
      addSnapshot(Math.max(1280, width), 'desktop', 'breakpoint-class', 'lg');
    }

    return snapshots;
  }

  toElementNode(elementId: string, depth: number = 0): McpElementNode | null {
    const element = this.content.elements.get(elementId);
    if (!element) return null;

    const children = depth > 0 ? this.getChildren(elementId, depth) : [];

    return {
      id: element.id,
      stableId: this.stableIdById.get(elementId),
      type: element.type,
      parentId: element.parentId,
      bounds: element.bounds,
      css: this.getCss(elementId, element),
      styles: this.getOutputStyles(elementId, element),
      textContent: element.textContent,
      children: children.length > 0 ? children : undefined,
      path: this.pathById.get(elementId),
      depth: this.depthById.get(elementId),
      order: this.orderById.get(elementId),
      source: this.getSourceSummary(elementId, element),
    };
  }

  private collectStyleHints(elementId?: string) {
    const hints = [] as McpAnnotationsOutput['styleHints'];

    for (const [id, element] of this.elementEntries) {
      if (elementId && id !== elementId) {
        continue;
      }

      const styles = element.styles;
      const margin = normalizeSpacingValue(styles.margin as string | number | undefined);
      const padding = normalizeSpacingValue(styles.padding as string | number | undefined);
      const gap = normalizeSpacingValue(styles.gap as string | number | undefined);
      const rowGap = normalizeSpacingValue(styles.rowGap as string | number | undefined);
      const columnGap = normalizeSpacingValue(styles.columnGap as string | number | undefined);

      if (margin || padding || gap || rowGap || columnGap) {
        hints.push({
          elementId: id,
          margin,
          padding,
          gap,
          rowGap,
          columnGap,
        });
      }
    }

    return hints;
  }

  private getChildren(parentId: string, maxDepth: number): string[] {
    if (maxDepth <= 0) return [];

    const children: string[] = [];
    const queue: Array<{ id: string; depth: number }> = [];
    const visited = new Set<string>();

    const directChildren = this.childrenByParent.get(parentId) || [];
    for (const id of directChildren) {
      queue.push({ id, depth: 1 });
    }

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      const { id, depth } = current;
      if (visited.has(id)) continue;
      visited.add(id);

      children.push(id);

      if (depth < maxDepth) {
        const nestedChildren = this.childrenByParent.get(id) || [];
        for (const childId of nestedChildren) {
          queue.push({ id: childId, depth: depth + 1 });
        }
      }
    }

    return children;
  }

  private applyDepthLimit(
    elements: McpElementEntries,
    maxDepth: number
  ): McpElementEntries {
    if (maxDepth < 0) return elements;

    return elements.filter(([id]) => {
      const depth = this.depthById.get(id);
      return (depth ?? 0) <= maxDepth;
    });
  }

  // backward-compatible aliases for apps/mcp wrapper
  transformOverview() {
    return this.overview();
  }

  transformElementList(typeFilter?: string) {
    return this.listElements(typeFilter);
  }

  transformElementDetail(elementId: string, depth?: number) {
    return this.getElement(elementId, depth);
  }

  transformToElementNode(elementId: string, depth: number = 0) {
    return this.toElementNode(elementId, depth);
  }
}

export function createMcpQuery(
  content: VZIContent,
  options?: Partial<McpQueryOptions>
): McpQuery {
  return new McpQuery(content, options);
}
