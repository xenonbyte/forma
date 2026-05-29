/**
 * artifact-manifest.ts
 * Forked from open-design daemon/src/artifact-manifest.ts, adapted for forma v8.
 *
 * ALLOWED_KINDS: html, design-system, markdown-document, svg, image, preview-only
 * react-component removed per SPEC-PLAN-015 user decision.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

export const ALLOWED_KINDS = [
  'html',
  'design-system',
  'design-page',          // 新：需求页面设计稿（替代旧 html 用法）
  'component-library',    // 新：generate_components 产物（替代旧 design-system 用法）
  'markdown-document',
  'svg',
  'image',
  'preview-only',
] as const;

export const ALLOWED_RENDERERS = [
  'html',
  'design-system',
  'markdown',
  'svg',
  'image',
  'preview-only',
] as const;

const ALLOWED_STATUSES = ['streaming', 'complete', 'error'] as const;

/** nanoid(16) 格式：纯字母数字，16 位 */
const ARTIFACT_ID_REGEX = /^[a-zA-Z0-9]{16}$/;

const MAX_TITLE_LENGTH = 200;
const MAX_REQUIREMENT_ID_BYTES = 128;
const MAX_METADATA_BYTES = 16 * 1024; // 16 KB

// ─── Types ───────────────────────────────────────────────────────────────────

export type ArtifactKind = typeof ALLOWED_KINDS[number];
export type ArtifactRenderer = typeof ALLOWED_RENDERERS[number];
export type ArtifactStatus = typeof ALLOWED_STATUSES[number];

// ─── forma 扩展命名空间 ─────────────────────────────────────────────────────
const PREVIEW_STATUSES = ['ready', 'failed'] as const;
const POINTER_DESIGN_STATUSES = ['pending', 'active', 'expired'] as const;

export interface ArtifactAssetEntry {
  /** 相对 bundle 根、须 ⊆ supportingFiles、不得逃逸 */
  path: string;
  /** 实际可得 density 集合（如 [1,2,3]；SVG 单份 [1]）。绝不上采样 */
  density: number[];
  /** 资源角色，如 image / icon / font */
  role: string;
  /** master 不足时实际档位不全 → true */
  degraded?: boolean;
}

export interface ArtifactProvenance {
  model?: string;
  sourceSkillId?: string;
  generatedAt?: string;
  promptDigest?: string;
}

export interface ArtifactCraftCheck {
  id: string;
  passed: boolean;
  detail?: string;
}

export interface ArtifactPreview {
  status: typeof PREVIEW_STATUSES[number];
  generatedAt?: string;
  error?: string;
}

export interface ArtifactFormaExtension {
  requirementId?: string;
  pageId?: string;
  variant?: string;        // design-page: 始终存在、默认 'default'、同 page 唯一
  brandStyle?: string;
  systemStyle?: string;
  platform?: string;
  language?: string;
  provenance?: ArtifactProvenance;
  quality?: { craftChecks?: ArtifactCraftCheck[] };
  preview?: ArtifactPreview;
  assets?: ArtifactAssetEntry[];
}

const LEGACY_KIND_MAP: Record<string, ArtifactKind> = {
  html: 'design-page',
  'design-system': 'component-library',
};

/** 读取面归一：把旧 kind 映射到新 kind，其余原样返回 */
export function normalizeKind(kind: string): ArtifactKind {
  return (LEGACY_KIND_MAP[kind] ?? kind) as ArtifactKind;
}

/** 读取面归一：缺 variant 的扩展补 'default' */
export function normalizeFormaExtension(forma: ArtifactFormaExtension): ArtifactFormaExtension {
  return { ...forma, variant: forma.variant ?? 'default' };
}

type FormaValidationResult =
  | { ok: true; value: ArtifactFormaExtension }
  | { ok: false; error: string };

export function validateFormaExtension(forma: unknown): FormaValidationResult {
  if (typeof forma !== 'object' || forma === null || Array.isArray(forma)) {
    return { ok: false, error: 'forma must be a non-null object' };
  }
  const f = forma as Record<string, unknown>;

  for (const key of ['requirementId', 'pageId', 'brandStyle', 'systemStyle', 'platform', 'language'] as const) {
    if (f[key] !== undefined && (typeof f[key] !== 'string' || (f[key] as string).length === 0)) {
      return { ok: false, error: `forma.${key} must be a non-empty string` };
    }
  }
  if (f['variant'] !== undefined && (typeof f['variant'] !== 'string' || (f['variant'] as string).length === 0)) {
    return { ok: false, error: 'forma.variant must be a non-empty string' };
  }

  if (f['preview'] !== undefined) {
    const p = f['preview'] as Record<string, unknown>;
    if (typeof p !== 'object' || p === null || !(PREVIEW_STATUSES as readonly string[]).includes(p['status'] as string)) {
      return { ok: false, error: `forma.preview.status must be one of: ${PREVIEW_STATUSES.join(', ')}` };
    }
  }

  if (f['assets'] !== undefined) {
    if (!Array.isArray(f['assets'])) {
      return { ok: false, error: 'forma.assets must be an array' };
    }
    for (const a of f['assets'] as unknown[]) {
      if (typeof a !== 'object' || a === null) return { ok: false, error: 'forma.assets entry must be an object' };
      const entry = a as Record<string, unknown>;
      if (validateSupportingPath(entry['path']) === null) {
        return { ok: false, error: `forma.assets path invalid: ${String(entry['path'])}` };
      }
      if (!Array.isArray(entry['density']) || (entry['density'] as unknown[]).some((d) => typeof d !== 'number' || d <= 0)) {
        return { ok: false, error: 'forma.assets density must be a non-empty array of positive numbers' };
      }
      if (typeof entry['role'] !== 'string' || entry['role'].length === 0) {
        return { ok: false, error: 'forma.assets role must be a non-empty string' };
      }
    }
  }

  if (f['provenance'] !== undefined && (typeof f['provenance'] !== 'object' || f['provenance'] === null || Array.isArray(f['provenance']))) {
    return { ok: false, error: 'forma.provenance must be an object' };
  }
  if (f['quality'] !== undefined) {
    const q = f['quality'] as Record<string, unknown>;
    if (typeof q !== 'object' || q === null || Array.isArray(q)) return { ok: false, error: 'forma.quality must be an object' };
    if (q['craftChecks'] !== undefined && !Array.isArray(q['craftChecks'])) {
      return { ok: false, error: 'forma.quality.craftChecks must be an array' };
    }
  }
  void POINTER_DESIGN_STATUSES; // 指针 designStatus 在 product.ts 校验，此处仅声明词表来源
  return { ok: true, value: f as ArtifactFormaExtension };
}

export interface ArtifactManifest {
  version: 1;
  id: string;
  kind: ArtifactKind;
  renderer: ArtifactRenderer;
  title: string;
  entry: string;
  supportingFiles?: string[];
  status: ArtifactStatus;
  exports: string[];
  requirementId?: string;
  sourceSkillId?: string;
  designSystemId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  forma?: ArtifactFormaExtension;
}

// ─── validateSupportingPath ───────────────────────────────────────────────────

/**
 * Validates a single supporting file path.
 * Returns the path string if valid, null otherwise.
 *
 * Rejects:
 * - non-strings
 * - empty strings
 * - null bytes
 * - absolute paths (Unix or Windows drive letters)
 * - Windows UNC paths
 * - path traversal (segments containing ..)
 */
export function validateSupportingPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  // Null byte
  if (value.includes('\x00')) {
    return null;
  }

  // Windows drive prefix: C:\... or C:/...
  if (/^[a-zA-Z]:[/\\]/.test(value)) {
    return null;
  }

  // Windows UNC path: \\server or //server
  if (/^[/\\]{2}/.test(value)) {
    return null;
  }

  // Absolute Unix path
  if (value.startsWith('/')) {
    return null;
  }

  // Path traversal: any segment that is ".." or starts with ".." followed by separator
  const segments = value.split(/[/\\]/);
  for (const seg of segments) {
    if (seg === '..') {
      return null;
    }
  }

  return value;
}

// ─── validateArtifactManifest ─────────────────────────────────────────────────

type ValidationResult =
  | { ok: true; value: ArtifactManifest }
  | { ok: false; error: string };

/**
 * Validates a raw unknown value as an ArtifactManifest.
 * Returns { ok: true, value } on success or { ok: false, error } on failure.
 */
export function validateArtifactManifest(manifest: unknown): ValidationResult {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    return { ok: false, error: 'manifest must be a non-null object' };
  }

  const m = manifest as Record<string, unknown>;

  // version
  if (m['version'] !== 1) {
    return { ok: false, error: 'version must be 1' };
  }

  // id — required, nanoid(16) format
  if (typeof m['id'] !== 'string') {
    return { ok: false, error: 'id is required and must be a string' };
  }
  if (!ARTIFACT_ID_REGEX.test(m['id'])) {
    return { ok: false, error: `id must match ${ARTIFACT_ID_REGEX} (16 alphanumeric characters)` };
  }

  // kind
  if (typeof m['kind'] !== 'string' || !(ALLOWED_KINDS as readonly string[]).includes(m['kind'])) {
    return { ok: false, error: `kind must be one of: ${ALLOWED_KINDS.join(', ')}` };
  }

  // renderer
  if (typeof m['renderer'] !== 'string' || !(ALLOWED_RENDERERS as readonly string[]).includes(m['renderer'])) {
    return { ok: false, error: `renderer must be one of: ${ALLOWED_RENDERERS.join(', ')}` };
  }

  // title
  if (typeof m['title'] !== 'string') {
    return { ok: false, error: 'title is required and must be a string' };
  }
  if (m['title'].length > MAX_TITLE_LENGTH) {
    return { ok: false, error: `title must not exceed ${MAX_TITLE_LENGTH} characters` };
  }

  // entry
  if (typeof m['entry'] !== 'string' || m['entry'].length === 0) {
    return { ok: false, error: 'entry is required and must be a non-empty string' };
  }
  if (validateSupportingPath(m['entry']) === null) {
    return { ok: false, error: `entry contains an invalid path: ${String(m['entry'])}` };
  }

  // status
  if (typeof m['status'] !== 'string' || !(ALLOWED_STATUSES as readonly string[]).includes(m['status'])) {
    return { ok: false, error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}` };
  }

  // exports — required non-empty array
  if (!Array.isArray(m['exports'])) {
    return { ok: false, error: 'exports must be an array' };
  }
  if ((m['exports'] as unknown[]).length === 0) {
    return { ok: false, error: 'exports must not be empty' };
  }

  // createdAt / updatedAt
  if (typeof m['createdAt'] !== 'string') {
    return { ok: false, error: 'createdAt is required and must be a string' };
  }
  if (typeof m['updatedAt'] !== 'string') {
    return { ok: false, error: 'updatedAt is required and must be a string' };
  }

  // supportingFiles — optional array; each item validated
  if (m['supportingFiles'] !== undefined) {
    if (!Array.isArray(m['supportingFiles'])) {
      return { ok: false, error: 'supportingFiles must be an array' };
    }
    for (const item of m['supportingFiles'] as unknown[]) {
      if (validateSupportingPath(item) === null) {
        return { ok: false, error: `supportingFiles contains an invalid path: ${String(item)}` };
      }
    }
  }

  // requirementId — optional, max 128 bytes
  if (m['requirementId'] !== undefined) {
    if (typeof m['requirementId'] !== 'string') {
      return { ok: false, error: 'requirementId must be a string' };
    }
    if (Buffer.byteLength(m['requirementId'], 'utf8') > MAX_REQUIREMENT_ID_BYTES) {
      return { ok: false, error: `requirementId must not exceed ${MAX_REQUIREMENT_ID_BYTES} bytes` };
    }
  }

  // sourceSkillId — optional string
  if (m['sourceSkillId'] !== undefined && typeof m['sourceSkillId'] !== 'string') {
    return { ok: false, error: 'sourceSkillId must be a string' };
  }

  // designSystemId — optional string
  if (m['designSystemId'] !== undefined && typeof m['designSystemId'] !== 'string') {
    return { ok: false, error: 'designSystemId must be a string' };
  }

  // metadata — optional, max 16KB serialized
  if (m['metadata'] !== undefined) {
    if (typeof m['metadata'] !== 'object' || m['metadata'] === null || Array.isArray(m['metadata'])) {
      return { ok: false, error: 'metadata must be a plain object' };
    }
    const serialized = JSON.stringify(m['metadata']);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_METADATA_BYTES) {
      return { ok: false, error: `metadata must not exceed ${MAX_METADATA_BYTES} bytes when serialized` };
    }
  }

  // forma 扩展（整体加性、但 design-page 写入必须带 forma.variant）
  let formaResult: FormaValidationResult | undefined;
  if (m['forma'] !== undefined) {
    formaResult = validateFormaExtension(m['forma']);
    if (!formaResult.ok) {
      return { ok: false, error: formaResult.error };
    }
  }
  // design-page：forma + forma.variant 必填（写入期强制；旧 html 读取兼容仍靠 normalize/backfill）
  if (m['kind'] === 'design-page') {
    if (formaResult === undefined) {
      return { ok: false, error: 'design-page manifest requires forma' };
    }
    // Redundant narrowing guard for tsc control-flow analysis (branch is unreachable at runtime)
    if (!formaResult.ok) return { ok: false, error: formaResult.error };
    if (formaResult.value.variant === undefined) {
      return { ok: false, error: 'design-page manifest requires forma.variant' };
    }
  }

  return {
    ok: true,
    value: m as unknown as ArtifactManifest,
  };
}
