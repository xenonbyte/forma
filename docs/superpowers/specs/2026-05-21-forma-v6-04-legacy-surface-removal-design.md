# Forma v6 04: Legacy Surface Removal Spec

## Source Design Scope

- DESIGN v6 sections: `MCP / Agent 工具调整`, `Web / Server API 调整`, `Agent 模板要求`, `当前代码冲突清单`, `实施顺序` step 4.
- DESIGN v6 acceptance IDs: 6, 13, 21, 38, 56.
- Depends on: `2026-05-21-forma-v6-02-async-startup-design.md`.

## Goal

Remove all public legacy page-level design surfaces before v6 strict read and write models are exposed. Explicit legacy calls must resolve to platform-level unknown tool, unknown command, or default 404 behavior, not Forma compatibility handlers.

## Non-Goals

- Do not implement new v6 design write tools.
- Do not implement new requirement-level Web routes beyond removal tests.
- Do not delete private helper code unless it is reachable from public runtime surface.
- Do not rewrite historical snapshots that intentionally describe removed names.

## Public Legacy Surfaces To Remove

MCP tools:

- `complete_product_init`,
- old one-shot `generate_components` write handler,
- `generate_page_design`,
- `save_designs`,
- `generate_and_save_page_design`,
- `rollback_design`,
- `diff_designs`,
- `get_design_annotations`,
- `export_design_asset`.

Agent routes and templates:

- `fm-refine-design` route,
- `fm-refine-design` template source for Codex, Claude, and Gemini,
- managed install manifest entries for `fm-refine-design`.

Server/Web routes:

- `/api/designs/:designId/annotations`,
- `/api/designs/:designId/image`,
- `/api/designs/:designId/image/file`,
- `/api/designs/:designId/history`,
- `/api/designs/:designId/diff`,
- `/api/designs/:designId/export`,
- `/products/:productId/requirements/:requirementId/designs/:designId`.

Docs/help/user-visible registries:

- `README.md`,
- `docs/AGENT.md`,
- `docs/MCP.md`,
- generated help output,
- package installer route lists,
- dispatcher-visible route lists,
- Web route table.

## Required Behavior

- Removed MCP tool names are not registered. Calling them produces the MCP platform's unknown tool response.
- Removed agent route names are not registered. Calling `fm-refine-design` produces the agent platform's unknown command behavior.
- Removed server API routes are not registered. Requests receive default 404.
- Removed Web design detail route is excluded from SPA fallback and receives default 404.
- Documentation and help must describe v6 alternatives without advertising removed names as available commands.
- Old names may remain only in historical design notes, removal notes, changelog text, and negative tests that assert unknown/404 behavior.

## Replacement Mapping

| Removed public surface | v6 replacement |
| --- | --- |
| `generate_page_design` / `save_designs` / `generate_and_save_page_design` | Requirement design session flow implemented later. |
| `rollback_design` | v6 `fm-rollback-design` route and requirement-level rollback tools implemented later. |
| `diff_designs` | `diff_requirement_design_versions` implemented later. |
| `get_design_annotations` | `get_requirement_design_scene` implemented later. |
| `export_design_asset` | `export_requirement_design_asset` implemented later. |
| one-shot MCP `generate_components` | Agent macro over product component session tools implemented later. |
| `complete_product_init` | No replacement; product component library commit becomes initialization. |
| `fm-refine-design` | `fm-design` action table handles refine/rebuild later. |

This stage documents replacement names only as forward references. It must not expose unfinished v6 replacement handlers as working public calls.

## Installer Behavior

`forma install` must:

- stop installing managed `fm-refine-design`,
- remove managed existing `fm-refine-design` target files and manifest entries during upgrade,
- leave non-managed user files untouched,
- not install docs or templates that call removed MCP tools.

## Failure Handling

- A removed tool or route must not enter a Forma handler that returns a custom legacy deprecation response.
- SPA fallback must not mask removed Web design detail routes.
- Docs checks must distinguish allowed historical references from user-visible runtime instructions.

## Out Of Scope

- New v6 MCP tool registration belongs to spec 08.
- New v6 agent templates belong to spec 09.
- New v6 Server/Web routes belong to spec 10.
- Strict schema deletion of `design_id` belongs to spec 05.

## Acceptance Criteria

- Removed MCP tool names are absent from registry and help output.
- Removed agent route names are absent from route list, dispatcher, templates, and managed manifest.
- Removed server API routes return default 404.
- Removed Web design detail route returns default 404 instead of `index.html`.
- `README.md`, `docs/AGENT.md`, `docs/MCP.md`, and user-visible templates no longer instruct users to use removed tools.
- Negative tests explicitly assert removed names are unavailable.

## Verification

- MCP tests assert removed tool names are not listed and unknown calls do not reach Forma handlers.
- Agent installer tests assert managed `fm-refine-design` files are removed and non-managed files are preserved.
- Server route tests assert old `/api/designs/:designId/*` routes return 404.
- Web route tests assert old design detail path is excluded from SPA fallback.
- Documentation checks search for removed names and allow only historical/removal/negative-test contexts.
