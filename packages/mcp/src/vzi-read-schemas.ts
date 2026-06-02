/**
 * VZI Read-Layer Input Schemas
 *
 * Zod schemas for the three MCP dev-handoff tools that read .vzi artifacts:
 *   get_design_handoff  – page overview + design tokens
 *   get_page_ui         – element tree at optional depth
 *   get_ui_node         – single element detail
 *
 * These schemas validate tool inputs only; output shapes come from
 * @vzi-core/transformer's McpQuery methods.
 */

import { z } from 'zod';

/** Path to a .vzi artifact file produced by Forma's archive step. */
export const vziPathSchema = z
  .string()
  .min(1, 'vziPath must not be empty');

/** Shared base for all three tools. */
const baseSchema = z.object({
  /** Absolute path to the .vzi file. */
  vziPath: vziPathSchema,
  /** Output format. Default: 'json'. */
  format: z.enum(['json', 'markdown']).default('json'),
});

/**
 * Schema for `get_design_handoff`.
 * Returns page overview (metadata, tokens, annotations, element summary).
 */
export const getDesignHandoffSchema = baseSchema.extend({
  /**
   * Type of design tokens to include.
   * 'all' (default) returns both colors and fonts.
   */
  tokenType: z.enum(['colors', 'fonts', 'all']).default('all'),
});

/**
 * Schema for `get_page_ui`.
 * Returns the element tree for dev inspection.
 */
export const getPageUiSchema = baseSchema.extend({
  /**
   * Element type filter. Omit for all elements.
   * One of: container, text, image, button, input, link, icon, shape.
   */
  type: z
    .enum(['container', 'text', 'image', 'button', 'input', 'link', 'icon', 'shape'])
    .optional(),
  /**
   * Tree depth limit (1 = top-level only, higher = deeper subtrees).
   * Defaults to full depth when omitted.
   */
  depth: z.number().int().positive().max(100).optional(),
});

/**
 * Schema for `get_ui_node`.
 * Returns detail for a single element by ID.
 */
export const getUiNodeSchema = baseSchema.extend({
  /** Element ID as returned by get_page_ui. */
  elementId: z.string().min(1, 'elementId must not be empty'),
  /**
   * How many levels of children to include.
   * 0 (default) = element only, no children.
   */
  depth: z.number().int().min(0).max(100).default(0),
});

export type GetDesignHandoffInput = z.infer<typeof getDesignHandoffSchema>;
export type GetPageUiInput = z.infer<typeof getPageUiSchema>;
export type GetUiNodeInput = z.infer<typeof getUiNodeSchema>;
