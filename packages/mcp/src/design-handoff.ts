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
 *   3. Resolve archived handoff manifests (legacy fallback: active pointers)
 *      → vziPath / indexHtmlPath / iconCount.
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
 *   - Path-safety: resolved path must be inside the current artifact dir (checked via
 *     isSameOrChildPath, same guard as artifact-paths.ts).
 *   - If the element has no iconRelativePath, assetRef is not added.
 */

import { constants as fsConstants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  FormaError,
  getArtifactDir,
  getArtifactIconsManifestPath,
  getArtifactVziPath,
  getArtifactVersionDir,
  getFormaPaths,
  isSameOrChildPath,
  listArchivedHandoffPages,
  readHandoffIconManifest,
  assertReadableHandoffFile,
  type HandoffPagePointer,
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

type PagePointerInfo = HandoffPagePointer;

function requirementPageIdSet(req: { pages?: Array<{ page_id?: string }> }): ReadonlySet<string> | undefined {
  const pageIds = (req.pages ?? [])
    .map((page) => page.page_id)
    .filter((pageId): pageId is string => typeof pageId === 'string' && pageId.length > 0);
  return pageIds.length > 0 ? new Set(pageIds) : undefined;
}

/**
 * Resolve active design pointers for a requirement to page info records.
 * Returns one record per active pointer for the given requirementId.
 */
async function resolveActivePagePointers(
  store: FormaStore,
  productId: string,
  requirementId: string,
  productsRoot: string,
  currentPageIds?: ReadonlySet<string>
): Promise<PagePointerInfo[]> {
  const allPointers = await store.products.listDesignPointers(productId);
  const pointers = allPointers.filter(
    (p) =>
      p.requirementId === requirementId &&
      p.designStatus === 'active' &&
      (!currentPageIds || currentPageIds.has(p.pageId))
  );

  const pages: PagePointerInfo[] = [];
  for (const ptr of pointers) {
    const { artifactId, version, pageId, variant } = ptr;
    const vziPath = getArtifactVziPath(productsRoot, productId, artifactId);
    const versionDir = getArtifactVersionDir(productsRoot, productId, artifactId, version);
    const indexHtmlPath = join(versionDir, 'index.html');
    const iconsManifestPath = getArtifactIconsManifestPath(productsRoot, productId, artifactId);
    await assertReadableHandoffFile(vziPath, artifactId, 'vzi');
    const iconCount = (await readHandoffIconManifest(iconsManifestPath, artifactId)).iconCount;

    pages.push({ pageId, variant, artifactId, version, vziPath, indexHtmlPath, iconCount });
  }

  return pages;
}

/**
 * Resolve handoff pages. Archive-generated manifests are authoritative because
 * icons/VZI are generated only during archive; active pointers may move later.
 * The active-pointer path remains as a legacy fallback for pre-manifest data.
 */
async function resolvePagePointers(
  store: FormaStore,
  productId: string,
  requirementId: string,
  productsRoot: string,
  currentPageIds?: ReadonlySet<string>
): Promise<PagePointerInfo[]> {
  const archivedPages = await listArchivedHandoffPages(productsRoot, productId, requirementId, currentPageIds);
  if (archivedPages.length > 0) {
    for (const page of archivedPages) {
      await assertReadableHandoffFile(page.vziPath, page.artifactId, 'vzi');
    }
    return archivedPages;
  }

  return resolveActivePagePointers(store, productId, requirementId, productsRoot, currentPageIds);
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
  productsRoot: string,
  currentPageIds?: ReadonlySet<string>,
  options: { variant?: string; artifactId?: string } = {}
): Promise<PagePointerInfo> {
  const pages = await resolvePagePointers(store, productId, requirementId, productsRoot, currentPageIds);
  const matches = pages.filter((p) =>
    p.pageId === pageId &&
    (options.variant === undefined || p.variant === options.variant) &&
    (options.artifactId === undefined || p.artifactId === options.artifactId)
  );
  if (matches.length > 1) {
    throw new FormaError(
      'ARTIFACT_INVALID_INPUT',
      `Multiple design variants found for requirement ${requirementId}, page ${pageId}; specify variant or artifact_id`,
      {
        requirement_id: requirementId,
        page_id: pageId,
        product_id: productId,
        variants: matches.map((p) => ({ variant: p.variant, artifactId: p.artifactId, version: p.version })),
      }
    );
  }
  const page = matches[0];
  if (!page) {
    throw new FormaError(
      'ARTIFACT_NOT_FOUND',
      `No design pointer found for requirement ${requirementId}, page ${pageId}`,
      {
        requirement_id: requirementId,
        page_id: pageId,
        product_id: productId,
        ...(options.variant !== undefined ? { variant: options.variant } : {}),
        ...(options.artifactId !== undefined ? { artifact_id: options.artifactId } : {}),
      }
    );
  }
  return page;
}

/**
 * Resolve an element's assetRef from its stored iconRelativePath to an
 * absolute path inside the artifact's dir. Returns undefined if no ref.
 *
 * Safety: the resolved path must be inside the current artifact dir. If it escapes,
 * throws FormaError('ARTIFACT_INVALID_INPUT') — this indicates tampering
 * or a write-path bug and must NOT be silently swallowed.
 */
async function resolveAssetRef(
  element: { metadata?: Record<string, unknown> } | undefined | null,
  artifactDir: string,
  artifactId: string
): Promise<string | undefined> {
  if (!element?.metadata) return undefined;
  const rel = element.metadata['iconRelativePath'];
  if (typeof rel !== 'string' || rel.length === 0) return undefined;

  const abs = resolve(join(artifactDir, rel));
  const root = resolve(artifactDir);
  if (!isSameOrChildPath(root, abs)) {
    // Path-safety violation — do not expose the escaped path in details
    throw new FormaError(
      'ARTIFACT_INVALID_INPUT',
      'Resolved icon asset path escapes the artifact root',
      { artifactId }
    );
  }

  try {
    await access(abs, fsConstants.R_OK);
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new FormaError(
        'ARTIFACT_NOT_FOUND',
        'Generated icon asset not found',
        { artifactId, handoffType: 'icons', relativePath: rel }
      );
    }
    throw new FormaError(
      'ARTIFACT_WRITE_FAIL',
      'Generated icon asset is unreadable',
      { artifactId, handoffType: 'icons', relativePath: rel, cause: err.message }
    );
  }

  return abs;
}

/**
 * Attach resolved assetRef to each element in the list that has an
 * iconRelativePath in its metadata. The content.elements Map provides the
 * raw element metadata; the query result list provides the element IDs.
 *
 * Throws FormaError('ARTIFACT_INVALID_INPUT') if any element's iconRelativePath
 * resolves outside the current artifact dir (propagates from resolveAssetRef).
 */
async function attachAssetRefs(
  elements: Array<{ id: string; assetRef?: string }>,
  content: VZIContent,
  artifactDir: string,
  artifactId: string
): Promise<void> {
  for (const el of elements) {
    const raw = content.elements.get(el.id);
    if (!raw) continue;
    const assetRef = await resolveAssetRef(
      raw as { metadata?: Record<string, unknown> },
      artifactDir,
      artifactId
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

  const pages = await resolvePagePointers(
    store,
    productId,
    requirement_id,
    productsRoot,
    requirementPageIdSet(req)
  );

  const rules = await store.requirements.getProductRules(productId);
  const translations = await store.copy.getTranslations(productId, requirement_id);

  return {
    requirement: {
      id: req.id,
      title: req.title,
      status: req.status,
    },
    pages: pages.map((p) => ({
      pageId: p.pageId,
      variant: p.variant,
      title: p.pageId,
      artifactId: p.artifactId,
      version: p.version,
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
  const { requirement_id, page_id, variant, artifact_id, depth, fields, node_id } = input;

  // Gate
  const req = await assertArchived(store, requirement_id);
  const productId = req.product_id;
  const productsRoot = getFormaPaths(store.home).productsDir;

  const pageInfo = await resolvePagePointer(
    store,
    productId,
    requirement_id,
    page_id,
    productsRoot,
    requirementPageIdSet(req),
    { variant, artifactId: artifact_id }
  );

  const content = await loadVzi(pageInfo.vziPath);

  // Determine type filter from fields
  let typeFilter: string | undefined;
  if (fields === 'text') typeFilter = 'text';
  else if (fields === 'visuals') typeFilter = 'image';
  // 'layout' and 'all' → no type filter

  const query = createMcpQuery(content, {
    format: 'json',
    depth: node_id ? undefined : depth,
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
    if (!rootNode) {
      throw new FormaError(
        'ARTIFACT_NOT_FOUND',
        `Node ${node_id} not found in page UI`,
        { requirementId: requirement_id, pageId: page_id, nodeId: node_id }
      );
    }
    const subtreeIds = new Set<string>([rootNode.id, ...(rootNode.children ?? [])]);
    const filtered = elementList.elements.filter((e) => subtreeIds.has(e.id));
    elementList = { ...elementList, elements: filtered, total: filtered.length };
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
  await attachAssetRefs(elementsWithAssetRef, content, artifactDir, pageInfo.artifactId);

  return {
    viewport: viewport ?? null,
    platform: platform ?? null,
    requirement_id,
    page_id,
    variant: pageInfo.variant,
    artifactId: pageInfo.artifactId,
    version: pageInfo.version,
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
  const { requirement_id, page_id, variant, artifact_id, node_id } = input;

  // Gate
  const req = await assertArchived(store, requirement_id);
  const productId = req.product_id;
  const productsRoot = getFormaPaths(store.home).productsDir;

  const pageInfo = await resolvePagePointer(
    store,
    productId,
    requirement_id,
    page_id,
    productsRoot,
    requirementPageIdSet(req),
    { variant, artifactId: artifact_id }
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
  const assetRef = await resolveAssetRef(
    raw as { metadata?: Record<string, unknown> } | undefined,
    artifactDir,
    pageInfo.artifactId
  );

  // Node-scoped annotations
  const annotations = query.getAnnotations(node_id);

  return {
    ...element,
    requirement_id,
    page_id,
    variant: pageInfo.variant,
    artifactId: pageInfo.artifactId,
    version: pageInfo.version,
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
  const { requirement_id, page_id, variant, artifact_id, query: searchQuery } = input;

  // Gate
  const req = await assertArchived(store, requirement_id);
  const productId = req.product_id;
  const productsRoot = getFormaPaths(store.home).productsDir;

  const pageInfo = await resolvePagePointer(
    store,
    productId,
    requirement_id,
    page_id,
    productsRoot,
    requirementPageIdSet(req),
    { variant, artifactId: artifact_id }
  );

  const content = await loadVzi(pageInfo.vziPath);
  const query = createMcpQuery(content, { format: 'json' });

  const result = query.searchElements(searchQuery);
  const artifactDir = getArtifactDir(productsRoot, productId, pageInfo.artifactId);
  const elementsWithAssetRef: Array<(typeof result.elements)[number] & { assetRef?: string }> =
    result.elements.map((el) => ({ ...el }));
  await attachAssetRefs(elementsWithAssetRef, content, artifactDir, pageInfo.artifactId);

  return {
    query: searchQuery,
    page_id,
    requirement_id,
    variant: pageInfo.variant,
    artifactId: pageInfo.artifactId,
    version: pageInfo.version,
    elements: elementsWithAssetRef,
    total: result.total,
  };
}
