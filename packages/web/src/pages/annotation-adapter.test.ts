import { describe, it, expect } from 'vitest';
import {
  SpatialIndexBuilder,
  VZIDecoder,
  VZIEncoder,
  type VZIContent,
} from '@vzi-core/format';
import {
  rewriteResourceUrl,
  withMissingResourcePlaceholders,
  composeAnnotationCanvas,
  type AdapterPageInput,
} from './annotation-adapter.js';

// Minimal VZIContent built from a flat element map (the decoded form the
// adapter consumes). Only the fields the adapter reads are populated.
function makeContent(
  elements: Array<Record<string, unknown>>,
  metadata: Record<string, unknown> = {},
  images = new Map<string, unknown>(),
): VZIContent {
  const map = new Map<string, unknown>();
  for (const el of elements) map.set(el.id as string, el);
  return {
    header: {}, metadata, elements: map, sharedStyles: new Map(),
    spatialIndex: new SpatialIndexBuilder().build(map as never), colorTokens: [], fontTokens: [], annotations: [],
    images: images as never, layers: [], compatibility: { minReaderVersion: '2.0.0', formatVersion: '2.0.0', features: [] },
  } as unknown as VZIContent;
}

const URLS = {
  iconBaseUrl: '/api/products/P-abc123/artifacts/A/icons/',
  bundleBaseUrl: '/api/products/P-abc123/artifacts/A/versions/1/bundle/',
};

describe('rewriteResourceUrl', () => {
  const ctx = { artifactId: 'A', pageId: 'home' };
  it('keeps data: URLs', () => {
    const errs: unknown[] = [];
    expect(rewriteResourceUrl('data:image/png;base64,xx', undefined, URLS, ctx, errs as never)).toBe('data:image/png;base64,xx');
    expect(errs).toHaveLength(0);
  });
  it('rewrites icons/ via iconBaseUrl', () => {
    const errs: never[] = [];
    expect(rewriteResourceUrl('icons/logo.svg', undefined, URLS, ctx, errs)).toBe(`${URLS.iconBaseUrl}logo.svg`);
  });
  it('uses metadata.iconRelativePath when present', () => {
    const errs: never[] = [];
    expect(rewriteResourceUrl('data:x', { iconRelativePath: 'icons/star.svg' }, URLS, ctx, errs)).toBe(`${URLS.iconBaseUrl}star.svg`);
  });
  it('rewrites assets/ via bundleBaseUrl', () => {
    const errs: never[] = [];
    expect(rewriteResourceUrl('assets/pic.png', undefined, URLS, ctx, errs)).toBe(`${URLS.bundleBaseUrl}assets/pic.png`);
  });
  it('rewrites artifact-version file: URLs via bundleBaseUrl', () => {
    const errs: never[] = [];
    const refs: unknown[] = [];
    expect(
      rewriteResourceUrl(
        'file:///Users/xubo/.forma/products/P-abc123/od-project/artifacts/A/v1/assets/pic.png',
        undefined,
        URLS,
        { ...ctx, resourceRefs: refs as never },
        errs,
      ),
    ).toBe(`${URLS.bundleBaseUrl}assets/pic.png`);
    expect(errs).toHaveLength(0);
    expect(refs).toEqual([
      {
        artifactId: 'A',
        pageId: 'home',
        path: 'assets/pic.png',
        kind: 'bundle',
        url: `${URLS.bundleBaseUrl}assets/pic.png`,
      },
    ]);
  });
  it('records a violation and drops remote http(s) URLs without fetching', () => {
    const errs: { reason: string }[] = [];
    expect(rewriteResourceUrl('https://evil.example/x.png', undefined, URLS, ctx, errs)).toBeUndefined();
    expect(errs[0].reason).toContain('remote');
  });
  it('records a violation for file: and absolute disk paths', () => {
    const errs: { reason: string }[] = [];
    expect(rewriteResourceUrl('file:///etc/passwd', undefined, URLS, ctx, errs)).toBeUndefined();
    expect(rewriteResourceUrl('/etc/passwd', undefined, URLS, ctx, errs)).toBeUndefined();
    expect(errs).toHaveLength(2);
  });
  it('records a violation for double-encoded traversal without fetching', () => {
    const errs: { reason: string }[] = [];
    expect(rewriteResourceUrl('icons/%252e%252e/x.svg', undefined, URLS, ctx, errs)).toBeUndefined();
    expect(errs).toHaveLength(1);
  });
  it('records a violation for traversal and backslash paths without fetching', () => {
    const errs: { reason: string }[] = [];
    expect(rewriteResourceUrl('icons/../x.svg', undefined, URLS, ctx, errs)).toBeUndefined();
    expect(rewriteResourceUrl('icons\\\\x.svg', undefined, URLS, ctx, errs)).toBeUndefined();
    expect(rewriteResourceUrl('icons%5Cx.svg', undefined, URLS, ctx, errs)).toBeUndefined();
    expect(rewriteResourceUrl('data:x', { iconRelativePath: '../x.svg' }, URLS, ctx, errs)).toBeUndefined();
    expect(errs).toHaveLength(4);
  });
});

describe('composeAnnotationCanvas', () => {
  function page(id: string, pageId: string): AdapterPageInput {
    return {
      pageId,
      artifactId: id,
      variant: 'default',
      title: pageId,
      content: makeContent(
        [
          { id: `${id}-root`, parentId: null, type: 'container', bounds: { x: 0, y: 0, width: 390, height: 800 }, styles: {} },
          { id: `${id}-child`, parentId: `${id}-root`, type: 'text', bounds: { x: 10, y: 20, width: 100, height: 30 }, styles: {}, textContent: 'Hi' },
        ],
        { formaViewport: { width: 390, height: 800 } },
      ),
      urls: URLS,
    };
  }

  it('produces a non-empty tree and tiles pages horizontally by viewport width + gap', () => {
    const result = composeAnnotationCanvas([page('A', 'home'), page('B', 'settings')], 80);
    expect(result.elements.length).toBeGreaterThan(0);
    expect(result.frames).toHaveLength(2);
    expect(result.frames[0].x).toBe(0);
    expect(result.frames[0].width).toBe(390);
    // second page offset = first width (390) + gap (80)
    expect(result.frames[1].x).toBe(470);
    // child of the second page is translated by 470
    const second = result.elements.find((e) => e.id === 'B-root');
    expect(second?.bounds.x).toBe(470);
    const secondChild = second?.children?.find((c) => c.id === 'B-child');
    expect(secondChild?.bounds.x).toBe(480); // 10 + 470
  });

  it('namespaces duplicate decoded element ids by artifact and page before merging pages', () => {
    function duplicateContent(label: string): VZIContent {
      return makeContent(
        [
          { id: 'root', parentId: null, type: 'container', bounds: { x: 0, y: 0, width: 100, height: 50 }, styles: {} },
          { id: 'ir_0', parentId: 'root', type: 'text', bounds: { x: 8, y: 12, width: 60, height: 20 }, styles: {}, textContent: label },
        ],
        { formaViewport: { width: 100, height: 50 } },
      );
    }

    const result = composeAnnotationCanvas([
      { pageId: 'home', artifactId: 'artifact-1', variant: 'default', title: 'Home', content: duplicateContent('Home'), urls: URLS },
      { pageId: 'settings', artifactId: 'artifact-1', variant: 'default', title: 'Settings', content: duplicateContent('Settings'), urls: URLS },
    ], 10);

    const firstRoot = result.elements.find((e) => e.id === 'artifact-1/home/root');
    const secondRoot = result.elements.find((e) => e.id === 'artifact-1/settings/root');

    expect(firstRoot?.children?.[0]?.id).toBe('artifact-1/home/ir_0');
    expect(secondRoot?.children?.[0]?.id).toBe('artifact-1/settings/ir_0');
    expect(firstRoot?.children?.[0]?.textContent).toBe('Home');
    expect(secondRoot?.children?.[0]?.textContent).toBe('Settings');
    expect(secondRoot?.bounds.x).toBe(110);
    expect(result.elements.some((e) => e.id === 'root')).toBe(false);
  });

  it('rewrites content.images refs and uses metadata asset IDs', () => {
    const content = makeContent(
      [
        {
          id: 'root',
          parentId: null,
          type: 'image',
          bounds: { x: 0, y: 0, width: 24, height: 24 },
          styles: {},
          metadata: { iconAssetId: 'img-1' },
        },
      ],
      { formaViewport: { width: 24, height: 24 } },
      new Map([['img-1', {
        id: 'img-1',
        storageType: 'external',
        url: 'icons/logo.svg',
        mimeType: 'image/svg+xml',
        width: 24,
        height: 24,
        size: 1,
        hash: 'h',
      }]]),
    );
    const result = composeAnnotationCanvas([{ pageId: 'home', artifactId: 'A', variant: 'default', title: 'Home', content, urls: URLS }]);
    expect(result.errors).toHaveLength(0);
    expect(result.elements[0].src).toBe(`${URLS.iconBaseUrl}logo.svg`);
    expect(result.resourceRefs).toEqual([
      {
        artifactId: 'A',
        pageId: 'home',
        path: 'icons/logo.svg',
        kind: 'icon',
        url: `${URLS.iconBaseUrl}logo.svg`,
      },
    ]);
  });

  it('exposes icon and bundle resource refs so AnnotationPage can prevalidate local assets', () => {
    const content = makeContent(
      [
        { id: 'icon', parentId: null, type: 'image', bounds: { x: 0, y: 0, width: 24, height: 24 }, styles: {}, imageData: { src: 'icons/missing.svg' } },
        { id: 'bundle', parentId: null, type: 'image', bounds: { x: 32, y: 0, width: 24, height: 24 }, styles: {}, imageData: { src: 'assets/missing.png' } },
      ],
      { formaViewport: { width: 64, height: 24 } },
    );
    const result = composeAnnotationCanvas([{ pageId: 'home', artifactId: 'A', variant: 'default', title: 'Home', content, urls: URLS }]);
    expect(result.errors).toHaveLength(0);
    expect(result.resourceRefs.map((r) => ({ kind: r.kind, path: r.path }))).toEqual([
      { kind: 'icon', path: 'icons/missing.svg' },
      { kind: 'bundle', path: 'assets/missing.png' },
    ]);
    const marked = withMissingResourcePlaceholders(result.elements, new Set([`${URLS.iconBaseUrl}missing.svg`]));
    expect(marked.find((e) => e.id === 'icon')?.src).toBeUndefined();
    expect(marked.find((e) => e.id === 'icon')?.styles.backgroundColor).toBe('#fee2e2');
  });

  it('rewrites and tracks CSS background-image URLs via the bundle base URL', () => {
    const content = makeContent(
      [
        {
          id: 'hero',
          parentId: null,
          type: 'container',
          bounds: { x: 0, y: 0, width: 320, height: 160 },
          styles: { backgroundImage: 'linear-gradient(#000, #111), url("assets/hero.png")' },
        },
      ],
      { formaViewport: { width: 320, height: 160 } },
    );
    const result = composeAnnotationCanvas([{ pageId: 'home', artifactId: 'A', variant: 'default', title: 'Home', content, urls: URLS }]);
    expect(result.errors).toHaveLength(0);
    expect(result.elements[0].styles.backgroundImage).toBe(`linear-gradient(#000, #111), url("${URLS.bundleBaseUrl}assets/hero.png")`);
    expect(result.resourceRefs).toEqual([
      {
        artifactId: 'A',
        pageId: 'home',
        path: 'assets/hero.png',
        kind: 'bundle',
        url: `${URLS.bundleBaseUrl}assets/hero.png`,
      },
    ]);
  });

  it('rewrites VZI file: image and background URLs captured from artifact HTML', () => {
    const content = makeContent(
      [
        {
          id: 'photo',
          parentId: null,
          type: 'image',
          bounds: { x: 0, y: 0, width: 64, height: 64 },
          styles: {},
          imageData: { src: 'file:///Users/xubo/.forma/products/P-abc123/od-project/artifacts/A/v1/assets/photo.png' },
        },
        {
          id: 'hero',
          parentId: null,
          type: 'container',
          bounds: { x: 0, y: 72, width: 320, height: 160 },
          styles: { backgroundImage: 'url("file:///Users/xubo/.forma/products/P-abc123/od-project/artifacts/A/v1/assets/hero.png")' },
        },
      ],
      { formaViewport: { width: 320, height: 232 } },
    );
    const result = composeAnnotationCanvas([{ pageId: 'home', artifactId: 'A', variant: 'default', title: 'Home', content, urls: URLS }]);
    expect(result.errors).toHaveLength(0);
    expect(result.elements.find((e) => e.id === 'photo')?.src).toBe(`${URLS.bundleBaseUrl}assets/photo.png`);
    expect(result.elements.find((e) => e.id === 'hero')?.styles.backgroundImage).toBe(`url("${URLS.bundleBaseUrl}assets/hero.png")`);
    expect(result.resourceRefs.map((r) => ({ kind: r.kind, path: r.path, url: r.url }))).toEqual([
      { kind: 'bundle', path: 'assets/photo.png', url: `${URLS.bundleBaseUrl}assets/photo.png` },
      { kind: 'bundle', path: 'assets/hero.png', url: `${URLS.bundleBaseUrl}assets/hero.png` },
    ]);
  });

  it('records and drops unsafe CSS background-image URLs before rendering', () => {
    const content = makeContent(
      [
        {
          id: 'hero',
          parentId: null,
          type: 'container',
          bounds: { x: 0, y: 0, width: 320, height: 160 },
          styles: { backgroundImage: 'url("https://evil.example/hero.png")' },
        },
      ],
      { formaViewport: { width: 320, height: 160 } },
    );
    const result = composeAnnotationCanvas([{ pageId: 'home', artifactId: 'A', variant: 'default', title: 'Home', content, urls: URLS }]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toContain('remote');
    expect(result.elements[0].styles.backgroundImage).toBeUndefined();
    expect(result.resourceRefs).toHaveLength(0);
  });

  it('turns a missing inline SVG icon reference into a placeholder instead of drawing stale svgData', () => {
    const content = makeContent(
      [
        {
          id: 'svg-icon',
          parentId: null,
          type: 'svg',
          bounds: { x: 0, y: 0, width: 24, height: 24 },
          styles: {},
          svgData: JSON.stringify({ type: 'rect', width: 24, height: 24, fill: '#111827' }),
          metadata: { iconAssetId: 'img-1', iconRelativePath: 'icons/missing.svg' },
        },
      ],
      { formaViewport: { width: 24, height: 24 } },
      new Map([['img-1', {
        id: 'img-1',
        storageType: 'external',
        url: 'icons/missing.svg',
        mimeType: 'image/svg+xml',
        width: 24,
        height: 24,
        size: 1,
        hash: 'h',
      }]]),
    );
    const result = composeAnnotationCanvas([{ pageId: 'home', artifactId: 'A', variant: 'default', title: 'Home', content, urls: URLS }]);
    expect(result.resourceRefs[0]).toMatchObject({ kind: 'icon', path: 'icons/missing.svg' });
    const marked = withMissingResourcePlaceholders(result.elements, new Set([`${URLS.iconBaseUrl}missing.svg`]));
    const icon = marked.find((e) => e.id === 'svg-icon');
    expect(icon?.src).toBeUndefined();
    expect(icon?.svgData).toBeUndefined();
    expect(icon?.styles.backgroundColor).toBe('#fee2e2');
  });

  it('decodes real VZI bytes and builds a non-empty CanvasKit element tree', () => {
    const source = makeContent([
      { id: 'root', parentId: null, type: 'container', bounds: { x: 0, y: 0, width: 320, height: 640 }, styles: {} },
      { id: 'title', parentId: 'root', type: 'text', bounds: { x: 16, y: 24, width: 200, height: 32 }, styles: {}, textContent: 'Home' },
    ], { formaViewport: { width: 320, height: 640 } });
    const bytes = new VZIEncoder().encode(source);
    const decodeResult = new VZIDecoder().decode(bytes);
    expect(decodeResult.errors.filter((e) => e.fatal)).toHaveLength(0);
    const result = composeAnnotationCanvas([{ pageId: 'home', artifactId: 'A', variant: 'default', title: 'Home', content: decodeResult.content, urls: URLS }]);
    expect(result.elements.length).toBeGreaterThan(0);
  });

  it('keeps a failed decoded page as a frame without adding CanvasKit elements', () => {
    const result = composeAnnotationCanvas([
      page('A', 'home'),
      {
        status: 'failed',
        pageId: 'settings',
        artifactId: 'B',
        variant: 'default',
        title: 'Settings',
        errorReason: 'HTTP 404',
      },
    ], 80);
    expect(result.elements.some((e) => e.id.startsWith('B-'))).toBe(false);
    expect(result.frames).toHaveLength(2);
    expect(result.frames[1]).toMatchObject({
      pageId: 'settings',
      artifactId: 'B',
      status: 'error',
      errorReason: 'HTTP 404',
    });
  });
});
