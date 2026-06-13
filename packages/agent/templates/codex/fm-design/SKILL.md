---
name: fm-design
description: Generate a static-HTML page design for a Forma requirement via MCP, then self-review.
---

# Forma route: fm-design

Codex route: `$fm-design`.

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Generate the static-HTML design for a requirement's page(s). You write the HTML; Forma localizes its assets, validates it is pure-static, stores a versioned bundle, renders a preview, and runs the deterministic craft lint.

Preconditions (tier 3 — strictest):
- Tier 1: a product must exist and be selected.
- Tier 2: the product must have at least one un-archived requirement.
- Tier 3: the requirement must have content and pages.
If the core tool returns `REQUIREMENT_NOT_FOUND`: no un-archived requirement is available — report the error faithfully and direct the user to create or activate a requirement in the Forma backstage. The agent does NOT create requirements.
If the core tool returns `REQUIREMENT_STATUS_INVALID`: the requirement is archived and cannot be used for design — report the error faithfully.

Modes:
- Full (no change description given): three steps — (1) plan the pages from the requirement, (2) generate each page, (3) self-review.
- Described (a change description argument given): a single pass — locate the affected page, regenerate only that page, self-review. Scope is the changed page; do not weaken self-review.

Execution:
1. Require product_id from context or ask the user to run `$fm-list-product` first.
2. Call `get_requirement` for the requirement, its `pages[]` and each `page_id`. If `ui_affected=false`, stop — there is no design to produce.
3. Confirm the `brand_style` and optional `system_style` (read product config / `list_styles`); confirm with the user when not already chosen.
4. Fetch design context BEFORE generating (recency matters): `get_design_context(product_id, requirement_id, page_id, brand_style, system_style)` returns craft rules + the selected brand/system style (tokens, components) + the page spec + applicable rules. Never call this after saving.

   **Component-library gate (B4 — two-stage stop):** Check `componentLibrary` in the response. `componentLibrary` is resolved via `product.designSystemArtifactId`; it is `undefined` when the pointer is unset. If `componentLibrary === undefined`, STOP immediately — do NOT generate any design page. Distinguish the two cases by calling `list_product_artifacts(product_id, kind="component-library", include_superseded=true)`:
   - ① Empty list → the product has never been refined. Instruct the user: "No component library exists yet — run `fm-refine-components` first to create one, then re-run `fm-design`."
   - ② Non-empty list but `designSystemArtifactId` not set → legacy: 已检测到旧组件库但未登记为当前；重跑一次 `fm-refine-components` 采纳并接管后续版本，完成后再重新运行 `fm-design`。 (Detected an old component-library artifact but it is not registered as the current one via `designSystemArtifactId`; re-run `fm-refine-components` once to adopt and take over, then re-run `fm-design`.)
   Gate on the POINTER (`designSystemArtifactId` / `componentLibrary`), NOT on list non-empty.

5. **Design read (before any HTML):** follow `craft/design-read.md` from the design context — state a one-line design read (surface kind: product UI vs marketing; audience; visual language within the selected brand style) and set the `DESIGN_VARIANCE` / `VISUAL_DENSITY` dials. Marketing-only rules in `craft/ai-tells.md` apply only when the read classifies the page as a marketing surface. The design read shapes execution only; it never adds scope beyond the page spec.

   **IMAGERY judgment (part of the design read):** decide whether the page spec calls for in-page illustration — a spot/empty-state graphic, an onboarding panel, or a marketing hero scene. This is in-page imagery (purpose `illustration` / `hero`), distinct from the brand app-icon above and from store/poster assets. Only when the page spec itself calls for imagery (an explicit empty-state / onboarding / marketing-hero need); this never adds scope beyond the page spec (see the Scope fidelity hard rule in step 6).
   - **If YES and an image model is configured:** build the generation prompt from the `illustration` (spot / empty state / onboarding) or `hero` (marketing hero) scaffold in `craft/image-prompts.md` — inject the resolved brand palette (hex + role) and honor the anti-slop bans. Call `generate_image(product_id, purpose="illustration", count=3)` (or `purpose="hero"` for a marketing hero). It returns `images[]`, each with `preview_path` and a staging `ref` of the form `forma-image://<uuid>`. **Veto (Read-inspection):** Read each candidate's `preview_path` and apply the veto checklist from `craft/image-prompts.md` (shared items + the per-purpose veto); reject any that trips a veto item and regenerate with a tightened prompt rather than shipping the least-bad one. Reference the chosen candidate in the page HTML via its `forma-image://<uuid>` staging ref (NOT the brand `forma-image://brand/app-icon` ref) — design-save localizes it into the bundle on save.
   - **If the image model is NOT configured** (`generate_image` returns `MEDIA_NOT_CONFIGURED`): DOWNGRADE — do NOT stop. Fall back to the current CSS/SVG decorative route for that imagery and continue producing the design. State the downgrade EXPLICITLY in the output report (e.g. "image model not configured, used CSS/SVG decoration instead"); never silently skip the illustration.
6. Generate the page as one self-contained static HTML document following the craft rules and style tokens. Follow the **Pure-static contract** in shared SKILL.md. **Scope fidelity (hard rule):** implement exactly the pages, sections, features, and elements listed in the page spec from `get_design_context`. Do NOT add pages, features, controls, or sections the requirement did not declare; when something is ambiguous, follow the page spec literally rather than inventing additions.

   **On-demand reuse (B5/B6):** When the page spec calls for a standard UI element, reuse the corresponding baseline component from `componentBaseline`/`componentLibrary` (same tokens, states, and interaction patterns) rather than inventing a one-off. Do NOT design-for-reuse (do not add extra components the page spec did not require); immersive or fully custom pages may omit or replace generic components. This guidance does NOT weaken the Scope fidelity hard rule above.

   **App-icon reference (D6 — the icon mark lives in brand assets, never hand-drawn):** when a page displays the product/app icon (e.g. a splash mark, login brand lockup, or a nav brand slot), reference the canonical brand app-icon in the HTML via `forma-image://brand/app-icon` (resolves to the 2048-px master square PNG; size it with CSS); Forma resolves these refs through the asset pipeline. If you need an exact-pixel variant, use `forma-image://brand/app-icon@<size>` where `<size>` MUST be a width value from `list_brand_assets(product_id, kind="app-icon")` → `files[].width` — an unavailable size throws MEDIA_IMAGE_NOT_FOUND and fails the entire save. When unsure, use the bare `forma-image://brand/app-icon` and size it with CSS. Do NOT inline a hand-drawn SVG mark or reuse any legacy `componentLibrary.productIcon`. Conditional precondition: call `list_brand_assets(product_id, kind="app-icon")`.
   - If the page spec involves ICON display (splash / login brand / nav brand slot) and NO app-icon exists, STOP — do NOT fabricate a mark — and guide the user: "This page shows the app icon but none exists yet — run `$fm-app-icon` first, then re-run `$fm-design`."
   - If the page does NOT depend on the icon, remind the user once that no app icon exists (referencing `$fm-app-icon`) and proceed.

   **Functional icons (hard rule):** never hand-draw functional icons. Call `search_icons` and inline the returned Lucide SVG (currentColor inheritance; stroke-width follows tokens). Decorative brand-specific glyphs defined by tokens are the only exception.

   **Mobile screen contract (when product platform is mobile):** output the screen content only — do NOT draw any device shell (no phone frame, bezel, notch chrome, or gesture bar; the outermost screen edges stay square, no rounded screen silhouette). DO draw the in-screen system status bar as the first element of every screen: time (9:41) on the left, signal/Wi-Fi/battery glyphs on the right, rendered flat as screen content (no notch or island cutout), with the app content starting below it.

   **Rule 1 (style/component changes are not retroactive):** `fm-change-style` and `fm-refine-components` do NOT retroactively regenerate already-produced design pages. Existing page versions remain immutable until the page is explicitly re-run via `fm-design`.
7. Save: `generate_requirement_design(product_id, requirement_id, page_id, html, title, brand_style, system_style[, variant])`. It returns `artifact_id`, `version`, `preview_status`.
8. Self-review (MANDATORY): run the **Self-review protocol** in shared SKILL.md. The save tool here is `generate_requirement_design`.
9. Report `artifact_id`, the final `version`, `preview_status`, and a short craftChecks summary. Report stable error codes exactly as returned.
