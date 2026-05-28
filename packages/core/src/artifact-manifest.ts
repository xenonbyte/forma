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

  return {
    ok: true,
    value: m as unknown as ArtifactManifest,
  };
}
