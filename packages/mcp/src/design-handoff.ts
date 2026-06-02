/**
 * design-handoff.ts
 *
 * Four read-only MCP tool implementations for developer design handoff:
 *   get_design_handoff  – entry gate + page directory
 *   get_page_ui         – element tree with tokens + annotations + assetRef
 *   get_ui_node         – single node full detail with annotations + assetRef
 *   search_page_ui      – search elements by text/type
 *
 * All four tools:
 *   1. Accept requirement_id only (no product_id) — product resolved internally.
 *   2. Gate on requirement.status === "archived" (REQUIREMENT_NOT_FINALIZED).
 *   3. Resolve design pointers → vziPath / indexHtmlPath / iconCount.
 *   4. Resolve element assetRef from stored iconRelativePath to absolute path.
 *   5. Are READ-ONLY (no writes).
 *
 * assetRef resolution contract:
 *   - During capture (requirement-vzi-capture.ts → injectIconRefs), each
 *     image/svg VZI element receives `element.metadata.iconRelativePath` =
 *     icon.files.svg, which is a relative path like "icons/<name>.svg".
 *   - We resolve it to an absolute path by joining the artifact dir with the
 *     relative path: getArtifactDir(productsRoot, productId, artifactId) +
 *     "/" + iconRelativePath.
 *   - Path-safety: resolved path must be inside productsRoot (checked via
 *     isSameOrChildPath, same guard as artifact-paths.ts).
 *   - If the element has no iconRelativePath, assetRef is not added.
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  FormaError,
  getArtifactDir,
  getArtifactIconsManifestPath,
  getArtifactVziPath,
  getArtifactVersionDir,
  getFormaPaths,
  isSameOrChildPath,
  type FormaStore,
} from '@xenonbyte/forma-core';
import { createMcpQuery } from '@vzi-core/transformer';
import { VZIDecoder } from '@vzi-core/format';
import type { VZIContent } from '@vzi-core/format';
import type {
  McpGetDesignHandoffInput,
  McpGetPageUiInput,
  McpGetUiNodeInput,
  McpSearchPageUiInput,
} from './vzi-read-schemas.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Load and decode a .vzi file from disk. Throws FormaError on failure. */
async function loadVzi(vziPath: string): Promise<VZIContent> {
  let buf: Buffer;
  try {
    buf = await readFile(vziPath);
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new FormaError('ARTIFACT_NOT_FOUND', `VZI file not found: ${vziPath}`, { vziPath });
    }
    throw new FormaError(
      'ARTIFACT_WRITE_FAIL',
      `Failed to read VZI file: ${vziPath} — ${err.message}`,
      { vziPath, cause: err.message }
    );
  }

  const decoder = new VZIDecoder({ enableErrorRecovery: true });
  const result = decoder.decode(new Uint8Array(buf));

  const fatals = result.errors.filter((e) => e.fatal);
  if (fatals.length > 0) {
    throw new FormaError(
      'ARTIFACT_UNSUPPORTED_FORMAT',
      `VZI decode fatal errors: ${fatals.map((e) => e.message).join('; ')}`,
      { vziPath, errors: fatals }
    );
  }

  return result.content;
}

/** Read icons.json manifest and return the icon count (0 if file absent). */
async function readIconCount(iconsManifestPath: string): Promise<number> {
  try {
    const raw = await readFile(iconsManifestPath, 'utf8');
    const manifest = JSON.parse(raw) as { icons?: unknown[] };
    return Array.isArray(manifest.icons) ? manifest.icons.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Resolve a requirement_id to its productId via store.
 * Uses getRequirement which returns product_id in the result.
 */
async function resolveProductId(store: FormaStore, requirementId: string): Promise<string> {
  const req = await store.requirements.getRequirement({ requirement_id: requirementId });
  return req.product_id;
}

/**
 * Gate: requirement must be archived. Throws REQUIREMENT_NOT_FINALIZED otherwise.
 */
async function assertArchived(store: FormaStore, requirementId: string) {
  const req = await store.requirements.getRequirement({ requirement_id: requirementId });
  if (req.status !== 'archived') {
    throw new FormaError(
      'REQUIREMENT_NOT_FINALIZED',
      `Requirement ${requirementId} is not yet archived (status: ${req.status}). ` +
        'Design handoff tools are only available after the requirement is archived.',
      { requirement_id: requirementId, status: req.status }
    );
  }
  return req;
}

interface PagePointerInfo {
  pageId: string;
  artifactId: string;
  version: number;
  vziPath: string;
  indexHtmlPath: string;
  iconCount: number;
}

/**
 * Resolve all design pointers for a requirement to page info records.
 * Returns one record per active pointer for the given requirementId.
 */
async function resolvePagePointers(
  store: FormaStore,
  productId: string,
  requirementId: string,
  productsRoot: string
): Promise<PagePointerInfo[]> {
  const allPointers = await store.products.listDesignPointers(productId);
  const pointers = allPointers.filter(
    (p) => p.requirementId === requirementId
  );

  const pages: PagePointerInfo[] = [];
  for (const ptr of pointers) {
    const { artifactId, version, pageId } = ptr;
    const vziPath = getArtifactVziPath(productsRoot, productId, artifactId);
    const versionDir = getArtifactVersionDir(productsRoot, productId, artifactId, version);
    const indexHtmlPath = join(versionDir, 'index.html');
    const iconsManifestPath = getArtifactIconsManifestPath(productsRoot, productId, artifactId);
    const iconCount = await readIconCount(iconsManifestPath);

    pages.push({ pageId, artifactId, version, vziPath, indexHtmlPath, iconCount });
  }

  return pages;
}

/**
 * Resolve a (requirementId, pageId) pair to its PagePointerInfo.
 * Throws ARTIFACT_NOT_FOUND if no matching pointer exists.
 */
async function resolvePagePointer(
  store: FormaStore,
  productId: string,
  requirementId: string,
  pageId: string,
  productsRoot: string
): Promise<PagePointerInfo> {
  const pages = await resolvePagePointers(store, productId, requirementId, productsRoot);
  const page = pages.find((p) => p.pageId === pageId);
  if (!page) {
    throw new FormaError(
      'ARTIFACT_NOT_FOUND',
      `No design pointer found for requirement ${requirementId}, page ${pageId}`,
      { requirement_id: requirementId, page_id: pageId, product_id: productId }
    );
  }
  return page;
}

/**
 * Resolve an element's assetRef from its stored iconRelativePath to an
 * absolute path inside the artifact's dir. Returns undefined if no ref.
 *
 * Safety: the resolved path must be inside productsRoot.
 */
function resolveAssetRef(
  element: { metadata?: Record<string, unknown> } | undefined | null,
  artifactDir: string,
  productsRoot: string
): string | undefined {
  if (!element?.metadata) return undefined;
  const rel = element.metadata['iconRelativePath'];
  if (typeof rel !== 'string' || rel.length === 0) return undefined;

  const abs = resolve(join(artifactDir, rel));
  const root = resolve(productsRoot);
  if (!isSameOrChildPath(root, abs)) {
    // Path-safety violation — do not expose the path
    return undefined;
  }
  return abs;
}

/**
 * Attach resolved assetRef to each element in the list that has an
 * iconRelativePath in its metadata. The content.elements Map provides the
 * raw element metadata; the query result list provides the element IDs.
 */
function attachAssetRefs(
  elements: Array<{ id: string; assetRef?: string }>,
  content: VZIContent,
  artifactDir: string,
  productsRoot: string
): void {
  for (const el of elements) {
    const raw = content.elements.get(el.id);
    if (!raw) continue;
    const assetRef = resolveAssetRef(
      raw as { metadata?: Record<string, unknown> },
      artifactDir,
      productsRoot
    );
    if (assetRef !== undefined) {
      el.assetRef = assetRef;
    }
  }
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

/**
 * get_design_handoff — entry gate + page directory.
 * Returns requirement metadata, page list with paths/iconCount, rules, and copy.
 */
export async function toolGetDesignHandoff(
  store: FormaStore,
  input: McpGetDesignHandoffInput
) {
  const { requirement_id } = input;
  const req = await assertArchived(store, requirement_id);
  const productId = req.product_id;
  const productsRoot = getFormaPaths(store.home).productsDir;

  const pages = await resolvePagePointers(store, productId, requirement_id, productsRoot);

  const rules = await store.requirements.getProductRules(productId);
  const translations = await store.copy.getTranslations(productId, requirement_id);

  return {
    requirement: {
      id: req.id,
      title: (req as Record<string, unknown>).title ?? req.id,
      status: req.status,
    },
    pages: pages.map((p) => ({
      pageId: p.pageId,
      title: p.pageId,
      vziPath: p.vziPath,
      indexHtmlPath: p.indexHtmlPath,
      iconCount: p.iconCount,
    })),
    rules,
    copy: translations,
  };
}

/**
 * get_page_ui — main page UI tool.
 * Returns viewport, platform, tokens, element tree, and annotations.
 * Top-level tokens are de-duplicated color/font. assetRef resolved to absolute.
 */
export async function toolGetPageUi(
  store: FormaStore,
  input: McpGetPageUiInput
) {
  const { requirement_id, page_id, depth, fields, node_id } = input;

  // Gate
  const req = await assertArchived(store, requirement_id);
  const productId = req.product_id;
  const productsRoot = getFormaPaths(store.home).productsDir;

  const pageInfo = await resolvePagePointer(
    store, productId, requirement_id, page_id, productsRoot
  );

  const content = await loadVzi(pageInfo.vziPath);

  // Determine type filter from fields
  let typeFilter: string | undefined;
  if (fields === 'text') typeFilter = 'text';
  else if (fields === 'visuals') typeFilter = 'image';
  // 'layout' and 'all' → no type filter

  const query = createMcpQuery(content, {
    format: 'json',
    depth,
    typeFilter,
  });

  // Tokens (top-level, de-duplicated)
  const tokensOutput = query.getTokens('all');

  // Annotations (full page)
  const annotationsOutput = query.getAnnotations();

  // Element tree
  let elementList = query.listElements(typeFilter);

  // If node_id specified, filter to subtree rooted at that node
  if (node_id) {
    const rootNode = query.getElement(node_id, depth ?? 100);
    if (rootNode) {
      // Collect all IDs in the subtree recursively
      const subtreeIds = new Set<string>();
      function collectIds(nodeId: string) {
        subtreeIds.add(nodeId);
        const el = query.getElement(nodeId, 0);
        if (el?.children) {
          for (const childId of el.children) {
            collectIds(childId);
          }
        }
      }
      collectIds(node_id);
      elementList = {
        ...elementList,
        elements: elementList.elements.filter((e) => subtreeIds.has(e.id)),
        total: elementList.elements.filter((e) => subtreeIds.has(e.id)).length,
      };
    }
  }

  // Build viewport from VZI metadata
  const extMeta = content.metadata as typeof content.metadata & Record<string, unknown>;
  const viewport = extMeta['formaViewport'] as { width: number; height: number } | undefined;
  const platform = extMeta['formaPlatform'] as string | null | undefined;

  // Attach assetRef to elements
  const artifactDir = getArtifactDir(productsRoot, productId, pageInfo.artifactId);
  const elementsWithAssetRef: Array<{
    id: string;
    type: string;
    bounds: unknown;
    css: string;
    textContent?: string;
    path?: string[];
    depth?: number;
    order?: number;
    source?: unknown;
    assetRef?: string;
  }> = elementList.elements.map((el) => ({ ...el }));
  attachAssetRefs(elementsWithAssetRef, content, artifactDir, productsRoot);

  return {
    viewport: viewport ?? null,
    platform: platform ?? null,
    tokens: {
      colors: tokensOutput.colors ?? [],
      fonts: tokensOutput.fonts ?? [],
    },
    tree: elementsWithAssetRef,
    annotations: annotationsOutput.annotations,
  };
}

/**
 * get_ui_node — full single node detail.
 * Returns complete styles + resolved asset path + parent/child ids + annotations.
 */
export async function toolGetUiNode(
  store: FormaStore,
  input: McpGetUiNodeInput
) {
  const { requirement_id, page_id, node_id } = input;

  // Gate
  const req = await assertArchived(store, requirement_id);
  const productId = req.product_id;
  const productsRoot = getFormaPaths(store.home).productsDir;

  const pageInfo = await resolvePagePointer(
    store, productId, requirement_id, page_id, productsRoot
  );

  const content = await loadVzi(pageInfo.vziPath);
  const query = createMcpQuery(content, { format: 'json' });

  const element = query.getElement(node_id, 100);
  if (!element) {
    throw new FormaError(
      'ARTIFACT_NOT_FOUND',
      `Node ${node_id} not found in VZI for page ${page_id}`,
      { requirement_id, page_id, node_id }
    );
  }

  // Resolve assetRef
  const artifactDir = getArtifactDir(productsRoot, productId, pageInfo.artifactId);
  const raw = content.elements.get(node_id);
  const assetRef = resolveAssetRef(
    raw as { metadata?: Record<string, unknown> } | undefined,
    artifactDir,
    productsRoot
  );

  // Node-scoped annotations
  const annotations = query.getAnnotations(node_id);

  return {
    ...element,
    ...(assetRef !== undefined ? { assetRef } : {}),
    annotations: annotations.annotations,
  };
}

/**
 * search_page_ui — search elements by text/type.
 */
export async function toolSearchPageUi(
  store: FormaStore,
  input: McpSearchPageUiInput
) {
  const { requirement_id, page_id, query: searchQuery } = input;

  // Gate
  const req = await assertArchived(store, requirement_id);
  const productId = req.product_id;
  const productsRoot = getFormaPaths(store.home).productsDir;

  const pageInfo = await resolvePagePointer(
    store, productId, requirement_id, page_id, productsRoot
  );

  const content = await loadVzi(pageInfo.vziPath);
  const query = createMcpQuery(content, { format: 'json' });

  const result = query.searchElements(searchQuery);

  return {
    query: searchQuery,
    page_id,
    requirement_id,
    elements: result.elements,
    total: result.total,
  };
}
