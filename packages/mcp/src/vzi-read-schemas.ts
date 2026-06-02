/**
 * VZI Read-Layer Input Schemas
 *
 * Zod schemas for both the internal VZI decode helpers and the four public
 * Forma MCP dev-handoff tools:
 *   get_design_handoff  – entry gate + page directory
 *   get_page_ui         – element tree at optional depth with tokens + annotations
 *   get_ui_node         – single element detail
 *   search_page_ui      – search elements by text/type
 *
 * Internal (vziPath-based) schemas are still exported for use by the
 * vzi-read-layer.ts pure decode helpers.
 * Public (requirement_id-based) schemas are used by the MCP tool handlers in
 * design-handoff.ts.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Internal (vziPath-based) schemas — used by vzi-read-layer.ts
// ---------------------------------------------------------------------------

/** Path to a .vzi artifact file produced by Forma's archive step. */
export const vziPathSchema = z
  .string()
  .min(1, 'vziPath must not be empty');

/** Shared base for all three internal tools. */
const baseSchema = z.object({
  /** Absolute path to the .vzi file. */
  vziPath: vziPathSchema,
  /** Output format. Default: 'json'. */
  format: z.enum(['json', 'markdown']).default('json'),
});

/**
 * Schema for `get_design_handoff` (internal).
 */
export const getDesignHandoffSchema = baseSchema.extend({
  tokenType: z.enum(['colors', 'fonts', 'all']).default('all'),
});

/**
 * Schema for `get_page_ui` (internal).
 */
export const getPageUiSchema = baseSchema.extend({
  type: z
    .enum(['container', 'text', 'image', 'button', 'input', 'link', 'icon', 'shape'])
    .optional(),
  depth: z.number().int().positive().max(100).optional(),
});

/**
 * Schema for `get_ui_node` (internal).
 */
export const getUiNodeSchema = baseSchema.extend({
  elementId: z.string().min(1, 'elementId must not be empty'),
  depth: z.number().int().min(0).max(100).default(0),
});

export type GetDesignHandoffInput = z.infer<typeof getDesignHandoffSchema>;
export type GetPageUiInput = z.infer<typeof getPageUiSchema>;
export type GetUiNodeInput = z.infer<typeof getUiNodeSchema>;

// ---------------------------------------------------------------------------
// Public MCP tool schemas — used by design-handoff.ts tool handlers
// ---------------------------------------------------------------------------

const requirementIdParam = z.object({
  requirement_id: z.string().min(1, 'requirement_id must not be empty'),
});

/**
 * Schema for the public `get_design_handoff` MCP tool.
 * Takes ONLY requirement_id — product is resolved internally.
 */
export const mcpGetDesignHandoffSchema = requirementIdParam.strict();

/**
 * Schema for the public `get_page_ui` MCP tool.
 */
export const mcpGetPageUiSchema = requirementIdParam
  .extend({
    page_id: z.string().min(1, 'page_id must not be empty'),
    variant: z.string().min(1, 'variant must not be empty').optional(),
    artifact_id: z.string().min(1, 'artifact_id must not be empty').optional(),
    /** Tree depth limit (1 = top-level only). Omit for full depth. */
    depth: z.number().int().positive().max(100).optional(),
    /**
     * Field projection: 'layout' | 'text' | 'visuals' | 'all'.
     * Defaults to 'all'.
     */
    fields: z.enum(['layout', 'text', 'visuals', 'all']).optional(),
    /**
     * If provided, return the subtree rooted at this node ID instead of the
     * full tree.
     */
    node_id: z.string().optional(),
  })
  .strict();

/**
 * Schema for the public `get_ui_node` MCP tool.
 */
export const mcpGetUiNodeSchema = requirementIdParam
  .extend({
    page_id: z.string().min(1, 'page_id must not be empty'),
    variant: z.string().min(1, 'variant must not be empty').optional(),
    artifact_id: z.string().min(1, 'artifact_id must not be empty').optional(),
    node_id: z.string().min(1, 'node_id must not be empty'),
  })
  .strict();

/**
 * Schema for the public `search_page_ui` MCP tool.
 */
export const mcpSearchPageUiSchema = requirementIdParam
  .extend({
    page_id: z.string().min(1, 'page_id must not be empty'),
    variant: z.string().min(1, 'variant must not be empty').optional(),
    artifact_id: z.string().min(1, 'artifact_id must not be empty').optional(),
    query: z.string().min(1, 'query must not be empty'),
  })
  .strict();

export type McpGetDesignHandoffInput = z.infer<typeof mcpGetDesignHandoffSchema>;
export type McpGetPageUiInput = z.infer<typeof mcpGetPageUiSchema>;
export type McpGetUiNodeInput = z.infer<typeof mcpGetUiNodeSchema>;
export type McpSearchPageUiInput = z.infer<typeof mcpSearchPageUiSchema>;
