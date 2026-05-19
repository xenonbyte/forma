# Page Design Persistence Design

## Context

This spec implements `design-version/DESIGN-v5.md` using approach A: the smallest backend/MCP change that makes page design generation and `.pen` persistence one atomic workflow.

The current `/design` / `$fm-design` flow depends on agents calling `generate_page_design` and then `save_designs`. `generate_page_design` only returns temporary Pencil output. If the second call is skipped, the new `.pen` does not enter `$FORMA_HOME/data/{product_id}/{requirement_id}/{design_id}/design.pen`, and the design can be lost when temporary files are cleaned.

## Goals

- Add `generate_and_save_page_design` as the normal page design generation entrypoint.
- Keep `generate_page_design` and `save_designs` for low-level and compatibility workflows.
- Return persisted design metadata, not temporary paths.
- Preserve existing `DesignService` version history, staging, rollback, and directory layout.
- Update agent templates and docs so normal `fm-design` uses the new atomic tool.

## Non-Goals

- No batch multi-page transaction.
- No Web UI status changes.
- No scanner or migration for already-orphaned temporary `.pen` files.
- No Pencil prompt strategy changes.
- No removal of existing MCP tools.

## Architecture

Add a store-level method in `packages/core/src/store.ts`:

```typescript
generateAndSavePageDesign(input: GenerateAndSavePageDesignInput): Promise<GenerateAndSavePageDesignResult>
```

The method composes existing services:

- `ProductService` validates product existence and required config fields.
- `RequirementService` loads the target requirement and page.
- `PencilService.generatePageDesign()` creates temporary `page.pen` and `preview.png`.
- `DesignService.saveDesignsLocked()` persists those files into the existing design directory structure.
- `DesignService.getDesignMetadata()` returns stable persisted paths.

The new method runs under the product mutation lock, matching the existing `generateComponents()` pattern.

## Data Flow

1. Agent reads the current product session and latest requirement.
2. Agent calls MCP `generate_and_save_page_design` for each target page.
3. MCP validates input with Zod and forwards to `store.generateAndSavePageDesign()`.
4. Store validates product config including `components_initialized`.
5. Store validates requirement ownership and target `page_id`.
6. Store maps `change_type` to save mode:

| change_type | save mode |
| --- | --- |
| `new` | `generate` |
| `patch` | `refine` |
| `rebuild` | `update` |

7. Store calls `PencilService.generatePageDesign()` with `product_id`, `prompt`, and `workspace`.
8. Store calls `DesignService.saveDesignsLocked()` with the generated `penPath`, `previewPath`, target `page_id`, and mapped mode.
9. Store calls `getDesignMetadata()` for the saved design id.
10. Store cleans the generated temporary directory.
11. MCP returns `product_id`, `requirement_id`, `page_id`, `design_id`, `version`, `pen_path`, and `preview_path`.

## Error Handling

- Missing product config or uninitialized components returns the existing `PRODUCT_CONFIG_INCOMPLETE` path.
- A requirement that does not belong to the product fails explicitly.
- A missing page fails explicitly.
- An unmapped `change_type` fails explicitly.
- Pencil generation failure does not save design state; `PencilService` keeps ownership of cleanup for generation failures.
- Save failure relies on `saveDesignsLocked()` rollback and then attempts temporary directory cleanup.
- Cleanup failure after save success must not roll back the persisted design. It should emit a warning through the existing mutation warning sink and return success.
- Cleanup failure after save failure should not hide the original save error. It should warn and rethrow the original error.

## MCP Changes

Update `packages/mcp/src/tools.ts`:

- Add `generate_and_save_page_design` to `formaToolNames`.
- Add a `generateAndSavePageDesignSchema`.
- Add `generate_and_save_page_design` to `formaToolInputSchemas`.
- Extend the `FormaStore` interface with optional `generateAndSavePageDesign`.
- Add a description that marks it as the normal `/design` workflow entrypoint.
- Update `generate_page_design` description to say it creates temporary output and is not the normal workflow.
- Add a handler that throws `STORE_METHOD_UNAVAILABLE` if the store method is missing.

## Agent And Docs Changes

Update these templates:

- `packages/agent/templates/codex/fm-design/SKILL.md`
- `packages/agent/templates/claude/fm-design.md`
- `packages/agent/templates/gemini/fm-design.toml`

Normal `fm-design` must call `generate_and_save_page_design`. The templates should keep the component initialization retry behavior, but the retried call should be the new atomic tool.

Update these docs:

- `docs/MCP.md`
- `docs/AGENT.md`
- `README.md` only if it currently describes the old two-step page design workflow.

Docs must state that `generate_page_design` returns temporary output and that normal workflows should use `generate_and_save_page_design`.

## Testing

Core tests should cover:

- Successful generation returns persisted `design.pen` and `preview@2x.png` paths.
- `new`, `patch`, and `rebuild` map to `generate`, `refine`, and `update`.
- Product/requirement/page mismatch fails.
- Save failure leaves no half-saved requirement page state.
- Temporary directory cleanup runs after save success and save failure.
- Cleanup failure after success returns the persisted result and emits a warning.

MCP tests should cover:

- Tool list includes `generate_and_save_page_design`.
- Schema rejects missing required fields.
- Handler calls `store.generateAndSavePageDesign()`.
- Handler reports `STORE_METHOD_UNAVAILABLE` when the store method is absent.
- `generate_page_design` description marks the output as temporary.

Template/docs checks should cover:

- `fm-design` templates use `generate_and_save_page_design` in default execution.
- Default execution no longer requires manual `generate_page_design` plus `save_designs`.
- Docs mark the new tool as recommended and the old generator as low-level temporary output.

## Acceptance Criteria

- Running `fm-design` through the updated template can complete a page design with a single persistence tool call.
- The returned `pen_path` points under `$FORMA_HOME/data/.../design.pen`.
- The returned `preview_path` points under `$FORMA_HOME/data/.../preview@2x.png`.
- Refreshing requirement metadata shows the saved design id and version.
- Old low-level tools still work for compatibility.
- Targeted core and MCP tests pass.
