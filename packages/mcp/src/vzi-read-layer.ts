/**
 * VZI Read-Layer
 *
 * Pure decode-and-project logic for the three Forma dev-handoff MCP tools.
 * Reads a .vzi file from disk, decodes it via @vzi-core/format, and projects
 * the result through @vzi-core/transformer's McpQuery interface.
 *
 * This module is intentionally side-effect free (no MCP server wiring).
 * The MCP tool registrations live in tools.ts and import from here.
 *
 * Excluded by design:
 *   - @vzi-core/renderer (dormant; web/desktop only)
 *   - @vzi-core/parser   (write path, not read path)
 *   - VZI apps/mcp server shell (not imported here)
 */

import { readFile } from 'node:fs/promises';
import { VZIDecoder } from '@vzi-core/format';
import { createMcpQuery } from '@vzi-core/transformer';
import { FormaError } from '@xenonbyte/forma-core';
import type {
  McpOverview,
  McpElementList,
  McpElementDetail,
  McpTokensOutput,
  McpAnnotationsOutput,
  McpQueryOptions,
} from '@vzi-core/transformer';
import type {
  GetDesignHandoffInput,
  GetPageUiInput,
  GetUiNodeInput,
} from './vzi-read-schemas.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Load and decode a .vzi file into a VZIContent object.
 * Throws FormaError-compatible errors so callers can map to MCP error codes.
 */
async function loadVzi(vziPath: string) {
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

  if (result.errors.length > 0) {
    const fatals = result.errors.filter((e) => e.fatal);
    if (fatals.length > 0) {
      throw new FormaError(
        'ARTIFACT_UNSUPPORTED_FORMAT',
        `VZI decode fatal errors: ${fatals.map((e) => e.message).join('; ')}`,
        { vziPath, errors: fatals }
      );
    }
    // Non-fatal errors are tolerated (degraded mode); callers may inspect result.
  }

  return result.content;
}

function buildQueryOptions(format: string): Partial<McpQueryOptions> {
  return { format: format as 'json' | 'markdown' };
}

// ---------------------------------------------------------------------------
// get_design_handoff
// ---------------------------------------------------------------------------

export interface DesignHandoffResult {
  overview: McpOverview;
  tokens: McpTokensOutput;
  annotations: McpAnnotationsOutput;
}

/**
 * Returns page-level overview, design tokens, and annotations for a .vzi file.
 * Corresponds to the `get_design_handoff` MCP tool.
 */
export async function getDesignHandoff(
  input: GetDesignHandoffInput
): Promise<DesignHandoffResult> {
  const { vziPath, format, tokenType } = input;
  const content = await loadVzi(vziPath);
  const query = createMcpQuery(content, buildQueryOptions(format));

  return {
    overview: query.overview(),
    tokens: query.getTokens(tokenType === 'all' ? undefined : tokenType),
    annotations: query.getAnnotations(),
  };
}

// ---------------------------------------------------------------------------
// get_page_ui
// ---------------------------------------------------------------------------

export interface PageUiResult {
  elements: McpElementList;
}

/**
 * Returns the element tree (optionally filtered by type and depth) for dev
 * inspection. Corresponds to the `get_page_ui` MCP tool.
 */
export async function getPageUi(input: GetPageUiInput): Promise<PageUiResult> {
  const { vziPath, format, type, depth } = input;
  const content = await loadVzi(vziPath);
  const query = createMcpQuery(content, {
    ...buildQueryOptions(format),
    depth,
    typeFilter: type,
  });

  // TODO(PLAN-TASK-008): resolve element image refs to absolute <artifactId>/icons/ asset paths (assetRef); pending icon export + tool wiring.
  return {
    elements: query.listElements(),
  };
}

// ---------------------------------------------------------------------------
// get_ui_node
// ---------------------------------------------------------------------------

export interface UiNodeResult {
  element: McpElementDetail | null;
}

/**
 * Returns detail for a single element by ID.
 * Corresponds to the `get_ui_node` MCP tool.
 */
export async function getUiNode(input: GetUiNodeInput): Promise<UiNodeResult> {
  const { vziPath, format, elementId, depth } = input;
  const content = await loadVzi(vziPath);
  const query = createMcpQuery(content, buildQueryOptions(format));

  // TODO(PLAN-TASK-008): resolve element image refs to absolute <artifactId>/icons/ asset paths (assetRef); pending icon export + tool wiring.
  return {
    element: query.getElement(elementId, depth),
  };
}
