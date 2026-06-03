/**
 * 字体管理器
 *
 * 负责加载和管理字体文件，支持中文等多语言字符
 * 使用 IndexedDB 缓存字体数据，避免重复下载
 */

import type { CanvasKit, Typeface, TypefaceFontProvider } from 'canvaskit-wasm';
import { FontCache } from './FontCache';

export interface FontManagerOptions {
  /**
   * 默认字体 URL（支持中文）
   */
  defaultFontUrl?: string;
}

export interface FontReadyEvent {
  family: string;
}

export type FontDiagnosticLevel = 'info' | 'warn' | 'error';

export interface FontDiagnosticEvent {
  name:
    | 'font-default-load-failed'
    | 'font-source-failed'
    | 'font-load-failed'
    | 'font-fallback'
    | 'font-ready';
  level: FontDiagnosticLevel;
  payload: Record<string, unknown>;
}

function isRendererDebugEnabled(): boolean {
  const globalConfig = globalThis as typeof globalThis & {
    __VZI_RENDERER_DEBUG__?: unknown;
  };
  return globalConfig.__VZI_RENDERER_DEBUG__ === true;
}

function rendererDebugLog(message: string, payload?: unknown): void {
  if (!isRendererDebugEnabled()) {
    return;
  }
  if (payload !== undefined) {
    let serialized = '';
    try {
      serialized = JSON.stringify(payload);
    } catch {
      serialized = '[unserializable payload]';
    }
    // eslint-disable-next-line no-console
    console.log(`[VZI][FontManager] ${message} ${serialized}`);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[VZI][FontManager] ${message}`);
}

/**
 * 字体映射到 CDN
 *
 * 注意：常见系统字体（Arial, sans-serif 等）不在此映射中，
 * 会直接使用默认字体（Noto Sans CJK），避免网络请求和 CORS 问题
 */
const LOCAL_RUNTIME_ASSET_BASE = '/runtime-assets';
const LOCAL_FONT_BASE = `${LOCAL_RUNTIME_ASSET_BASE}/fonts`;

function isNodeRuntime(): boolean {
  return (
    typeof process !== 'undefined' &&
    !!process.versions &&
    !!process.versions.node
  );
}

type NodeRequire = (id: string) => unknown;
type NodeFsModule = {
  existsSync(path: string): boolean;
  readFileSync(path: string | URL): Uint8Array & {
    buffer: ArrayBuffer;
    byteOffset: number;
    byteLength: number;
  };
};
type NodePathModule = {
  resolve(...segments: string[]): string;
  join(...segments: string[]): string;
};

function getNodeRequire(): NodeRequire | null {
  if (!isNodeRuntime()) {
    return null;
  }

  try {
    return Function('return typeof require !== "undefined" ? require : null')() as NodeRequire | null;
  } catch {
    return null;
  }
}

function getNodeFs(): NodeFsModule | null {
  const requireFn = getNodeRequire();
  if (!requireFn) {
    return null;
  }

  try {
    return requireFn('fs') as NodeFsModule;
  } catch {
    return null;
  }
}

function getNodePath(): NodePathModule | null {
  const requireFn = getNodeRequire();
  if (!requireFn) {
    return null;
  }

  try {
    return requireFn('path') as NodePathModule;
  } catch {
    return null;
  }
}

function normalizeBaseUrl(base: string): string {
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function getNodeLocalFontBaseCandidates(): string[] {
  const nodeFs = getNodeFs();
  const nodePath = getNodePath();
  if (!nodeFs || !nodePath) {
    return [];
  }

  const candidates = new Set<string>();
  const cwd = typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '';
  const startDirs = [cwd, nodePath.resolve(cwd, '..'), nodePath.resolve(cwd, '../..')].filter(Boolean);

  for (const startDir of startDirs) {
    for (const relativePath of [
      '.runtime-cache/runtime-assets/fonts',
      'runtime-assets/fonts',
      'public/runtime-assets/fonts',
      'packages/web/public/runtime-assets/fonts',
    ]) {
      const candidate = nodePath.resolve(startDir, relativePath);
      if (nodeFs.existsSync(candidate)) {
        candidates.add(candidate);
      }
    }
  }

  return [...candidates];
}

function getLocalFontBaseCandidates(): string[] {
  if (isNodeRuntime()) {
    return getNodeLocalFontBaseCandidates();
  }

  const globalConfig = globalThis as typeof globalThis & {
    __VZI_FONT_BASE_URL__?: unknown;
    __VZI_RUNTIME_ASSET_BASE_URL__?: unknown;
  };

  const explicitFontBase =
    typeof globalConfig.__VZI_FONT_BASE_URL__ === 'string'
      ? globalConfig.__VZI_FONT_BASE_URL__.trim()
      : '';
  const runtimeAssetBase =
    typeof globalConfig.__VZI_RUNTIME_ASSET_BASE_URL__ === 'string'
      ? globalConfig.__VZI_RUNTIME_ASSET_BASE_URL__.trim()
      : '';

  const candidates = new Set<string>();

  if (explicitFontBase) {
    candidates.add(normalizeBaseUrl(explicitFontBase));
  }

  if (runtimeAssetBase) {
    candidates.add(`${normalizeBaseUrl(runtimeAssetBase)}/fonts`);
  }

  if (typeof document !== 'undefined' && typeof document.baseURI === 'string') {
    try {
      const fromBaseUri = new URL('runtime-assets/fonts/', document.baseURI).toString();
      candidates.add(normalizeBaseUrl(fromBaseUri));
    } catch {
      // ignore invalid base URI
    }
  }

  candidates.add(LOCAL_FONT_BASE);

  return [...candidates];
}

function withLocalFontFirst(localFile: string, urls: string[]): string[] {
  const nodePath = isNodeRuntime() ? getNodePath() : null;
  const localCandidates = getLocalFontBaseCandidates().map((base) =>
    nodePath ? nodePath.join(base, localFile) : `${base}/${localFile}`
  );
  const merged = [...localCandidates, ...urls];
  const deduped = new Set<string>();
  for (const url of merged) {
    if (url) {
      deduped.add(url);
    }
  }
  return [...deduped];
}

/** Local bundled font candidates only — no remote fallback (spec §5.3). */
function localFontUrls(localFile: string): string[] {
  return withLocalFontFirst(localFile, []);
}

function mergeUniqueUrls(...groups: string[][]): string[] {
  const deduped = new Set<string>();
  for (const group of groups) {
    for (const url of group) {
      if (url) {
        deduped.add(url);
      }
    }
  }
  return [...deduped];
}

function isAllowedBrowserFontUrl(url: string): boolean {
  if (isNodeRuntime()) return false;
  if (!/^https?:\/\//i.test(url)) return !url.startsWith('file:');
  if (typeof document === 'undefined' || typeof document.baseURI !== 'string') return false;
  try {
    const parsed = new URL(url);
    const base = new URL(document.baseURI);
    return parsed.origin === base.origin && parsed.pathname.includes('/runtime-assets/fonts/');
  } catch {
    return false;
  }
}

const MATERIAL_SYMBOLS_OUTLINED_URLS = mergeUniqueUrls(
  localFontUrls('MaterialSymbolsOutlined-Variable.ttf'),
  localFontUrls('MaterialIcons-Regular.ttf'),
);
const MATERIAL_SYMBOLS_ROUNDED_URLS = mergeUniqueUrls(
  localFontUrls('MaterialSymbolsRounded-Variable.ttf'),
  localFontUrls('MaterialIcons-Regular.ttf'),
);
const MATERIAL_SYMBOLS_SHARP_URLS = mergeUniqueUrls(
  localFontUrls('MaterialSymbolsSharp-Variable.ttf'),
  localFontUrls('MaterialIcons-Regular.ttf'),
);
const MATERIAL_ICONS_URLS = localFontUrls('MaterialIcons-Regular.ttf');
const INTER_URLS = localFontUrls('Inter-Variable.ttf');
const MONOSPACE_URLS = localFontUrls('NotoSansMono-Variable.ttf');

const FONT_URL_MAP: Record<string, string[]> = {
  default: mergeUniqueUrls(
    localFontUrls('NotoSansCJKsc-Regular.otf'),
    localFontUrls('NotoSans-Variable.ttf'),
  ),
  'space grotesk': localFontUrls('SpaceGrotesk-Variable.ttf'),
  inter: INTER_URLS,
  'font-display': INTER_URLS,
  'ui-monospace': MONOSPACE_URLS,
  'sfmono-regular': MONOSPACE_URLS,
  menlo: MONOSPACE_URLS,
  monaco: MONOSPACE_URLS,
  consolas: MONOSPACE_URLS,
  'liberation mono': MONOSPACE_URLS,
  'courier new': MONOSPACE_URLS,
  monospace: MONOSPACE_URLS,
  'material symbols outlined': MATERIAL_SYMBOLS_OUTLINED_URLS,
  'material-symbols-outlined': MATERIAL_SYMBOLS_OUTLINED_URLS,
  'material symbols rounded': MATERIAL_SYMBOLS_ROUNDED_URLS,
  'material-symbols-rounded': MATERIAL_SYMBOLS_ROUNDED_URLS,
  'material symbols sharp': MATERIAL_SYMBOLS_SHARP_URLS,
  'material-symbols-sharp': MATERIAL_SYMBOLS_SHARP_URLS,
  'material icons': MATERIAL_ICONS_URLS,
  'material-icons': MATERIAL_ICONS_URLS,
};

const DEFAULT_FONT_FAMILIES = new Set(['default', 'defaultfont', 'sans-serif', 'sans']);

function normalizeFontFamilyName(value: string): string {
  return value.trim().toLowerCase().replace(/['"]/g, '');
}

function splitFontFamilies(fontFamily: string): string[] {
  return fontFamily
    .split(',')
    .map((family) => normalizeFontFamilyName(family))
    .filter((family) => family.length > 0);
}

const FONT_FETCH_TIMEOUT_MS = 10000;

async function fetchWithTimeout(url: string, timeoutMs = FONT_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 字体管理器单例
 */
export class FontManager {
  private static instance: FontManager | null = null;
  private canvasKit: CanvasKit | null = null;
  private runtimeGeneration = 0;
  private typefaceCache: Map<string, Typeface | null> = new Map();
  private fontDataCache: Map<string, ArrayBuffer> = new Map(); // 保存字体数据
  private loadingPromises: Map<string, Promise<Typeface | null>> = new Map();
  private defaultTypeface: Typeface | null = null;
  private defaultFontData: ArrayBuffer | null = null;
  private fontCache: FontCache = new FontCache(); // IndexedDB 缓存
  private globalFontProvider: TypefaceFontProvider | null = null; // 全局 TypefaceFontProvider
  private registeredProviderFamilies: Set<string> = new Set();
  private fontReadyListeners: Set<(event: FontReadyEvent) => void> = new Set();
  private diagnosticListeners: Set<(event: FontDiagnosticEvent) => void> = new Set();

  private constructor() {}

  /**
   * 获取字体管理器实例
   */
  static getInstance(): FontManager {
    if (!FontManager.instance) {
      FontManager.instance = new FontManager();
    }
    return FontManager.instance;
  }

  subscribeFontReady(listener: (event: FontReadyEvent) => void): () => void {
    this.fontReadyListeners.add(listener);
    return () => {
      this.fontReadyListeners.delete(listener);
    };
  }

  subscribeDiagnostics(listener: (event: FontDiagnosticEvent) => void): () => void {
    this.diagnosticListeners.add(listener);
    return () => {
      this.diagnosticListeners.delete(listener);
    };
  }

  private emitFontReady(event: FontReadyEvent): void {
    for (const listener of this.fontReadyListeners) {
      try {
        listener(event);
      } catch (error) {
        console.warn('[FontManager] 字体就绪监听器执行失败', error);
      }
    }
  }

  private emitDiagnostic(event: FontDiagnosticEvent): void {
    for (const listener of this.diagnosticListeners) {
      try {
        listener(event);
      } catch (error) {
        console.warn('[FontManager] 字体诊断监听器执行失败', error);
      }
    }
  }

  /**
   * 初始化字体管理器
   */
  async init(canvasKit: CanvasKit, options: FontManagerOptions = {}): Promise<void> {
    // React StrictMode 下组件可能触发二次初始化，直接复用已就绪的字体提供器，
    // 避免重复创建 provider 但未重建注册映射而导致文本缺字。
    if (
      this.canvasKit === canvasKit &&
      this.globalFontProvider &&
      this.defaultFontData
    ) {
      rendererDebugLog('init reuse existing provider', {
        registeredFamilyCount: this.registeredProviderFamilies.size,
      });
      return;
    }

    this.canvasKit = canvasKit;
    rendererDebugLog('init start', {
      hasDefaultFontUrl: !!options.defaultFontUrl,
      localFontCandidates: getLocalFontBaseCandidates(),
    });

    if (this.globalFontProvider) {
      this.globalFontProvider.delete();
      this.globalFontProvider = null;
    }

    this.registeredProviderFamilies.clear();

    // 创建全局 TypefaceFontProvider
    this.globalFontProvider = canvasKit.TypefaceFontProvider.Make();

    // 先重建已缓存字体在 provider 内的注册状态
    if (this.defaultFontData) {
      this.registerFontData(this.defaultFontData, ['DefaultFont', 'defaultfont', 'default', 'sans-serif', 'sans']);
    }
    for (const [family, fontData] of this.fontDataCache.entries()) {
      if (!fontData) {
        continue;
      }
      if (family === 'default' || family === 'defaultfont' || family === 'sans-serif' || family === 'sans') {
        continue;
      }
      this.registerFontData(fontData, [family]);
    }

    // 加载默认字体（支持中文）
    let defaultFontData = this.defaultFontData;
    if (!defaultFontData) {
      const defaultUrls = options.defaultFontUrl
        ? [options.defaultFontUrl]
        : (FONT_URL_MAP['default'] || []);
      defaultFontData = await this.loadFontData(defaultUrls, 'default');
    }

    if (defaultFontData) {
      this.defaultFontData = defaultFontData;
      this.registerFontData(defaultFontData, ['DefaultFont', 'defaultfont', 'default', 'sans-serif', 'sans']);

      // 也创建 Typeface 用于其他用途
      if (!this.defaultTypeface) {
        this.defaultTypeface = canvasKit.Typeface.MakeFreeTypeFaceFromData(defaultFontData);
      }
      this.typefaceCache.set('default', this.defaultTypeface);
      rendererDebugLog('default font loaded', {
        cacheKey: 'default',
        bytes: defaultFontData.byteLength,
      });
    } else {
      rendererDebugLog('default font load failed');
      this.emitDiagnostic({
        name: 'font-default-load-failed',
        level: 'error',
        payload: {
          cacheKey: 'default',
          sources: FONT_URL_MAP['default'] || [],
        },
      });
    }
    rendererDebugLog('init done', {
      hasProvider: !!this.globalFontProvider,
      hasDefaultTypeface: !!this.defaultTypeface,
    });
  }

  /**
   * 获取全局 FontProvider
   */
  getGlobalFontProvider(): TypefaceFontProvider | null {
    return this.globalFontProvider;
  }

  /**
   * 检查字体是否已经注册到全局 FontProvider
   */
  isFontRegistered(fontFamily: string): boolean {
    const families = splitFontFamilies(fontFamily);
    return families.some((family) => this.registeredProviderFamilies.has(family));
  }

  /**
   * 加载字体数据（不创建 Typeface）
   */
  private async loadFontData(urls: string[], cacheKey: string): Promise<ArrayBuffer | null> {
    try {
      let fontData: ArrayBuffer | null = null;
      rendererDebugLog('loadFontData start', {
        cacheKey,
        sourceCount: urls.length,
      });

      for (const url of urls) {
        // 1. 尝试从 IndexedDB 缓存读取
        try {
          fontData = await this.fontCache.get(url);
          if (fontData) {
            rendererDebugLog('font cache hit', {
              cacheKey,
              url,
              bytes: fontData.byteLength,
            });
            break;
          }
          rendererDebugLog('font cache miss', { cacheKey, url });
        } catch (error) {
          console.warn('[FontManager] IndexedDB 读取失败，将从网络加载:', error);
        }

        // 2. 如果缓存未命中，从网络下载
        try {
          fontData = await this.fetchFontDataByUrl(url);
          rendererDebugLog('font download success', {
            cacheKey,
            url,
            bytes: fontData.byteLength,
          });
          try {
            await this.fontCache.set(url, fontData);
          } catch (cacheError) {
            console.warn('[FontManager] 写入 IndexedDB 缓存失败，将继续使用内存字体:', cacheError);
          }
          break;
        } catch (error) {
          console.warn(`[FontManager] 字体下载失败，将尝试下一个源: ${url}`, error);
          this.emitDiagnostic({
            name: 'font-source-failed',
            level: 'warn',
            payload: {
              cacheKey,
              url,
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }

      if (!fontData) {
        throw new Error('No available font source');
      }

      // 4. 保存到内存缓存
      this.fontDataCache.set(normalizeFontFamilyName(cacheKey), fontData);
      rendererDebugLog('loadFontData done', {
        cacheKey,
        bytes: fontData.byteLength,
      });

      return fontData;
    } catch (error) {
      console.error(`❌ 字体加载失败: ${cacheKey}`, error);
      this.emitDiagnostic({
        name: cacheKey === 'default' ? 'font-default-load-failed' : 'font-load-failed',
        level: 'error',
        payload: {
          cacheKey,
          message: error instanceof Error ? error.message : String(error),
        },
      });
      return null;
    }
  }

  private registerFontData(fontData: ArrayBuffer, familyAliases: string[]): void {
    if (!this.globalFontProvider) {
      return;
    }

    for (const alias of familyAliases) {
      const normalizedAlias = normalizeFontFamilyName(alias);
      if (!normalizedAlias || this.registeredProviderFamilies.has(normalizedAlias)) {
        continue;
      }

      try {
        this.globalFontProvider.registerFont(fontData, normalizedAlias);
        this.registeredProviderFamilies.add(normalizedAlias);
        rendererDebugLog('font registered', { alias: normalizedAlias });
      } catch (error) {
        console.warn(`[FontManager] 字体注册失败: ${normalizedAlias}`, error);
      }
    }
  }

  /**
   * 根据 font-family 获取 Typeface（异步，会加载字体）
   */
  async getTypeface(fontFamily: string): Promise<Typeface | null> {
    if (!this.canvasKit) {
      return this.defaultTypeface;
    }

    const families = splitFontFamilies(fontFamily);
    const isNode = isNodeRuntime();

    // 尝试每个字体
    for (const family of families) {
      if (DEFAULT_FONT_FAMILIES.has(family)) {
        rendererDebugLog('getTypeface uses default family', { fontFamily, family });
        return this.defaultTypeface;
      }

      // 检查缓存
      if (this.typefaceCache.has(family)) {
        const cached = this.typefaceCache.get(family);
        if (cached) return cached;
        continue;
      }

      // 检查是否有映射的字体 URL
      const fontUrls = FONT_URL_MAP[family];
      if (fontUrls && fontUrls.length > 0) {
        if (isNode) {
          const typeface = await this.loadFont(fontUrls, family);
          if (typeface) return typeface;
          continue;
        }

        if (!this.loadingPromises.has(family)) {
          rendererDebugLog('getTypeface schedule background load', { fontFamily, family });
          void this.loadFont(fontUrls, family)
            .then((typeface) => {
              rendererDebugLog('getTypeface background load finished', {
                fontFamily,
                family,
                loaded: !!typeface,
              });
            })
            .catch((error) => {
              console.warn(`[FontManager] 后台字体加载失败: ${family}`, error);
            });
        }
      }
    }

    // 浏览器端优先返回默认字体，避免阻塞首帧；真实字体会在后台加载并写入缓存。
    rendererDebugLog('getTypeface fallback to default', { fontFamily });
    this.emitDiagnostic({
      name: 'font-fallback',
      level: this.defaultTypeface ? 'warn' : 'error',
      payload: {
        requestedFontFamily: fontFamily,
        resolvedFamily: this.defaultTypeface ? 'default' : null,
        hasDefaultTypeface: !!this.defaultTypeface,
      },
    });
    return this.defaultTypeface;
  }

  /**
   * 同步获取已缓存的 Typeface（不会加载新字体）
   */
  getTypefaceSync(fontFamily: string): Typeface | null {
    if (!this.canvasKit) {
      return this.defaultTypeface;
    }

    const families = splitFontFamilies(fontFamily);

    // 尝试从缓存中获取
    for (const family of families) {
      if (DEFAULT_FONT_FAMILIES.has(family)) {
        return this.defaultTypeface;
      }
      if (this.typefaceCache.has(family)) {
        const cached = this.typefaceCache.get(family);
        if (cached) return cached;
      }
    }

    // 回退到默认字体
    return this.defaultTypeface;
  }

  /**
   * 加载字体文件
   */
  private async loadFont(urls: string[], cacheKey: string): Promise<Typeface | null> {
    // 检查是否正在加载
    if (this.loadingPromises.has(cacheKey)) {
      return this.loadingPromises.get(cacheKey)!;
    }

    // 开始加载
    const generation = this.runtimeGeneration;
    const loadPromise = this.loadFontInternal(urls, cacheKey, generation);
    this.loadingPromises.set(cacheKey, loadPromise);

    try {
      const typeface = await loadPromise;
      if (generation === this.runtimeGeneration) {
        this.typefaceCache.set(cacheKey, typeface);
      }
      return typeface;
    } finally {
      this.loadingPromises.delete(cacheKey);
    }
  }

  /**
   * 内部加载逻辑
   */
  private async loadFontInternal(
    urls: string[],
    cacheKey: string,
    generation: number
  ): Promise<Typeface | null> {
    const canvasKit = this.canvasKit;
    if (!canvasKit) {
      return null;
    }

    try {
      const fontData = await this.loadFontData(urls, cacheKey);
      if (!fontData) {
        throw new Error('Failed to load font data');
      }

      if (generation !== this.runtimeGeneration || this.canvasKit !== canvasKit) {
        rendererDebugLog('drop stale font load result', { cacheKey, generation });
        return null;
      }

      // 4. 保存到内存缓存
      const normalizedCacheKey = normalizeFontFamilyName(cacheKey);
      this.fontDataCache.set(normalizedCacheKey, fontData);
      this.registerFontData(fontData, [cacheKey]);

      // 5. 创建 Typeface
      const typeface = canvasKit.Typeface.MakeFreeTypeFaceFromData(fontData);

      if (!typeface) {
        throw new Error('Failed to create typeface from font data');
      }

      if (!isNodeRuntime()) {
        this.emitFontReady({ family: normalizedCacheKey });
        this.emitDiagnostic({
          name: 'font-ready',
          level: 'info',
          payload: {
            family: normalizedCacheKey,
            bytes: fontData.byteLength,
          },
        });
      }

      return typeface;
    } catch (error) {
      console.error(`❌ 字体加载失败: ${cacheKey}`, error);
      this.emitDiagnostic({
        name: cacheKey === 'default' ? 'font-default-load-failed' : 'font-load-failed',
        level: 'error',
        payload: {
          cacheKey,
          message: error instanceof Error ? error.message : String(error),
        },
      });
      return null;
    }
  }

  /**
   * 获取字体数据（用于 ParagraphBuilder）
   */
  getFontData(fontFamily: string): ArrayBuffer | null {
    const families = splitFontFamilies(fontFamily);

    // 尝试从缓存中获取
    for (const family of families) {
      if (this.fontDataCache.has(family)) {
        return this.fontDataCache.get(family) || null;
      }
    }

    // 回退到默认字体数据
    return this.defaultFontData;
  }

  private async fetchFontDataByUrl(url: string): Promise<ArrayBuffer> {
    const browserLocal = isAllowedBrowserFontUrl(url);
    if (browserLocal) {
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch local font: ${response.statusText}`);
      }
      return await response.arrayBuffer();
    }

    if (!/^https?:\/\//i.test(url)) {
      const nodeFs = getNodeFs();
      if (!nodeFs) {
        throw new Error('Local font loading is only available in Node.js runtime');
      }
      const resolvedPath = url.startsWith('file://') ? new URL(url) : url;
      const fileBuffer = nodeFs.readFileSync(resolvedPath);
      return fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);
    }

    throw new Error(`Remote font URL is not allowed in local-only FontManager: ${url}`);
  }

  /**
   * 获取默认 Typeface
   */
  getDefaultTypeface(): Typeface | null {
    return this.defaultTypeface;
  }

  /**
   * 检查是否已加载
   */
  isLoaded(): boolean {
    return this.defaultTypeface !== null;
  }

  /**
   * 重置字体管理器
   */
  reset(): void {
    // 清理所有 typeface
    for (const typeface of this.typefaceCache.values()) {
      if (typeface) {
        typeface.delete();
      }
    }
    this.typefaceCache.clear();
    this.loadingPromises.clear();

    if (this.defaultTypeface) {
      this.defaultTypeface.delete();
      this.defaultTypeface = null;
    }

    if (this.globalFontProvider) {
      this.globalFontProvider.delete();
      this.globalFontProvider = null;
    }

    this.registeredProviderFamilies.clear();
    this.fontDataCache.clear();
    this.canvasKit = null;
    this.runtimeGeneration += 1;
  }
}
