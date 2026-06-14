---
description: Generate a product's app icon by AI image generation, veto by checklist, and persist as the canonical brand app-icon.
---

# Forma route: fm-app-icon

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Generate a product's launcher app icon via the configured AI image provider, inspect the candidates against the veto checklist, pick the best, and persist it as the canonical brand app-icon. You generate a small set of MASTER images (not per-size icons); Forma core derives the ENTIRE per-platform/surface variant set locally (sharp) from those masters and ATOMICALLY REPLACES the product's app-icon set. The app icon is product-level — it has no requirement or page, and does NOT need any design previews.

A bare `fm-app-icon` rerun (no description) = FULL regeneration of the app icon. Because v1 keeps no version tree, a save atomically replaces the whole app-icon set; before executing a bare rerun, double-confirm with the user that they want to regenerate and replace the existing app icon.

Preconditions (all fail = STOP + guidance; never silently proceed):
- A product must exist and be selected. If absent, guide the user to run `fm-list-product` first (and to create/select a product if none exists).
- The product must be configured (`platform` + `brand_style`). If either is unset, STOP here (before calling any tool) and guide the user to run `init_product_config` (or the backstage config) before retrying. The per-platform/surface variant set is derived from `platform`, so this is required. (This is a template-layer STOP; no tool error code is produced because no tool is called.)
- An image model must be configured. There is no tool that reports the media config to the agent, so the precondition surfaces from the generator: if `generate_image` returns `MEDIA_NOT_CONFIGURED`, STOP and tell the user to configure an image model in the web **Settings →「图片模型」(Image model)** section, then re-run. Do NOT retry blindly or fall back to a placeholder.

fm-app-icon does NOT need an existing app icon (it creates one) and does NOT need design previews.

Execution:
1. Require product_id from context or ask the user to run `fm-list-product` first.
2. Read the product config (platform + brand_style). If `brand_style` or `platform` is unset, STOP and guide to `init_product_config` (see preconditions). Confirm the `brand_style` with the user when not already chosen.
3. **Overwrite check (double-confirm on bare rerun):** call `list_brand_assets(product_id, kind="app-icon")`. If an app-icon already exists, this run is an OVERWRITE — core atomically replaces the whole app-icon set (v1 keeps no version tree). State the overwrite explicitly and, for a bare `fm-app-icon` rerun, double-confirm with the user before generating ("an app icon already exists; this will fully regenerate and replace it — proceed?"). If none exists, this is the first creation.
4. Read the plan so you know how many master images to produce: `get_brand_asset_plan(product_id)` returns `entries[]`; the `kind="app-icon"` entries carry `baseImages` (mobile/tablet surfaces → `["a","b","c"]`; web/desktop → `["a","b"]`). Mobile/tablet need 3 masters; web/desktop need 2.
5. Fetch the palette BEFORE prompting: `get_style(brand_style)` returns DESIGN.md (design principles) + tokens.css (design tokens). Read the resolved hex values and their roles (primary accent / ink / surface) — these get injected verbatim into the prompts.
6. Build the master-image generation prompts from the **app-icon master scaffolds in `craft/image-prompts.md`** (`app-icon-logo` / `app-icon-bg` / `app-icon-safe`). Inject the actual brand palette (resolved hex + role) and the product positioning. The masters are:
   - **a (logo):** the brand mark on a fully TRANSPARENT background, no surrounding fill (PNG with alpha).
   - **b (background):** an OPAQUE branded background fill with NO alpha — the icon's base tile color/texture, no logo on it.
   - **c (safe-area logo, mobile/tablet only):** the logo placed inside the 666×666 adaptive safe area on a 1080×1080 TRANSPARENT canvas, so platform masking never clips it.
   Each scaffold locks: a single centered subject, brand-color-forward, **no text or letterforms**, no device frame / mockup chrome, no multiple competing subjects, legible down to ~24px. Repeat the locked palette at the end of every prompt. Honor every anti-slop ban (no AI gradients, no glass orbs/chrome spheres, no stock clichés, no lens flares, no watermarks/fake marks).
7. Generate each master: `generate_image(product_id, purpose="app-icon", count=3)` with the matching master prompt (default aspect `1:1`). If it returns `MEDIA_NOT_CONFIGURED`, STOP and guide to Settings (see preconditions). Each call returns `images[]`, each with `preview_path` (absolute local path) and `ref` (`forma-image://<uuid>`).
8. **Veto (the Read-inspection step):** for each master, Read the 3 `preview_path` candidates and apply the veto checklist from `craft/image-prompts.md` — reject any with garbled/gibberish text, broken anatomy/impossible perspective, off-brand style drift, watermarks/stray UI chrome, or compression artifacts; plus the matching per-master veto (logo: reject if the background is not transparent or it contains text; bg: reject if it carries alpha or shows the logo; safe: reject if the logo bleeds outside the 666² safe area or the canvas is not transparent). Pick the best surviving `ref` for each master. If ALL 3 of a master trip a veto item, do NOT ship the least-bad one — regenerate with a tightened prompt.
9. Persist with ONE call. The save is a discriminated union on `kind`; for `kind="app-icon"` you pass only the master refs (brand_style + platform come from the product config — do NOT pass them):
   `save_brand_asset(product_id, kind="app-icon", logo_ref=<a>, bg_ref=<b>, safe_logo_ref=<c>  (mobile/tablet only), colors?={mono?, tint?, dark_bg?})`.
   Core resolves the masters, derives the ENTIRE per-platform/surface variant set locally (sharp), and ATOMICALLY REPLACES the product's app-icon set. It returns `{ kind:"app-icon", assets:[{kind, name, files:[{path,width,height}], variant, surface?, brand_style, generated_at}] }`. You do not name or pick a canonical record and there is no per-size generation: the canonical brand ref `forma-image://brand/app-icon` resolves automatically to the largest STANDARD-variant file.
10. Report the derived variant set (the `assets[]` records — `name` / `variant` / `surface?` plus each `files[]` path + dimensions) and the brand-assets canvas URL `/products/<product_id>/brand-assets` where the icon renders. Report stable error codes exactly as returned. The real codes reachable in this flow: `MEDIA_NOT_CONFIGURED` (image model not configured, from `generate_image`); `BRAND_ASSET_INVALID_INPUT` (from `save_brand_asset`, e.g. `details.reason: "product_not_configured"` when brand_style/platform is missing).

The brand-asset save tool is `save_brand_asset`; the image generator is `generate_image`; the plan reader is `get_brand_asset_plan`.
