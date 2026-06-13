---
name: fm-app-icon
description: Generate a product's app icon by AI image generation, veto by checklist, and persist as the canonical brand app-icon.
---

# Forma route: fm-app-icon

Codex route: `$fm-app-icon`.

Use shared Forma guidance at ~/.forma/skills/forma/SKILL.md.

Generate a product's launcher app icon via the configured AI image provider, inspect the candidates against the veto checklist, pick the best, and persist it as the canonical brand app-icon. You construct the prompt; Forma core passes it through verbatim (never rewrites it), stages the candidates, and on save derives the per-platform icon size set + favicon. The app icon is product-level — it has no requirement or page, and does NOT need any design previews.

Preconditions (all fail = STOP + guidance; never silently proceed):
- A product must exist and be selected. If absent, guide the user to run `$fm-list-product` first (and to create/select a product if none exists).
- The product must be configured (`platform` + `brand_style`). If either is unset, STOP here (before calling any tool) and guide the user to run `init_product_config` (or the backstage config) before retrying. The per-platform icon size set is derived from `platform`, so this is required. (This is a template-layer STOP; no tool error code is produced because no tool is called.)
- An image model must be configured. There is no tool that reports the media config to the agent, so the precondition surfaces from the generator: if `generate_image` returns `MEDIA_NOT_CONFIGURED`, STOP and tell the user to configure an image model in the web **Settings →「图片模型」(Image model)** section, then re-run. Do NOT retry blindly or fall back to a placeholder.

fm-app-icon does NOT need an existing app icon (it creates one) and does NOT need design previews.

Execution:
1. Require product_id from context or ask the user to run `$fm-list-product` first.
2. Read the product config (platform + brand_style). If `brand_style` or `platform` is unset, STOP and guide to `init_product_config` (see preconditions). Confirm the `brand_style` with the user when not already chosen.
3. **Overwrite check:** call `list_brand_assets(product_id, kind="app-icon")`. If an app-icon already exists, this run is an OVERWRITE (v1 keeps no version tree) — state the overwrite explicitly to the user ("an app icon already exists; this will replace it"), then proceed. If none exists, this is the first creation.
4. Fetch the palette BEFORE prompting: `get_style(brand_style)` returns DESIGN.md (design principles) + tokens.css (design tokens). Read the resolved hex values and their roles (primary accent / ink / surface) — these get injected verbatim into the prompt.
5. Build the generation prompt from the **`app-icon` scaffold in `craft/image-prompts.md`** (Intent / Composition / Include / Avoid). Inject the actual brand palette (resolved hex + role) and the product positioning. The scaffold locks: a single centered subject, brand-color-forward, **no text or letterforms**, no device frame / mockup chrome, no multiple competing subjects, legible down to ~24px. Repeat the locked palette at the end of the prompt. Honor every anti-slop ban (no AI gradients, no glass orbs/chrome spheres, no stock clichés, no lens flares, no watermarks/fake marks).
6. Generate: `generate_image(product_id, purpose="app-icon", count=3)` with that prompt (default aspect `1:1`). If it returns `MEDIA_NOT_CONFIGURED`, STOP and guide to Settings (see preconditions). It returns `images[]`, each with `preview_path` (absolute local path) and `ref` (`forma-image://<uuid>`).
7. **Veto (the Read-inspection step):** Read each of the 3 `preview_path` candidates and apply the veto checklist from `craft/image-prompts.md` — reject any with garbled/gibberish text, broken anatomy/impossible perspective, off-brand style drift, watermarks/stray UI chrome, or compression artifacts; plus the app-icon per-purpose veto (reject if it contains any text, shows a phone/device frame, has more than one focal subject, or loses its silhouette at ~24px). Pick the best surviving candidate. If ALL 3 trip a veto item, do NOT ship the least-bad one — regenerate with a tightened prompt.
8. Persist the chosen candidate as the canonical app-icon: `save_brand_asset(product_id, kind="app-icon", name="primary", source={ image_ref: <chosen ref> })`. The name MUST be `"primary"`: the brand-ref resolver maps `forma-image://brand/app-icon` to the record named `primary` (else the most-recent), so `fm-design` and other consumers resolve the icon deterministically only when it is saved as `primary`. The tool reads `brand_style` + `platform` from the product config and derives the per-platform icon size set + favicon. It returns `{ kind, name, files:[{path,width,height}], generated_at, warnings }`.
9. Report the derived size set (the `files[]` paths + dimensions) and the brand-assets canvas URL `/products/<product_id>/brand-assets` where the icon renders. Report stable error codes exactly as returned. The real codes reachable in this flow: `MEDIA_NOT_CONFIGURED` (image model not configured, from `generate_image`); `BRAND_ASSET_INVALID_INPUT` (from `save_brand_asset`, e.g. `details.reason: "product_not_configured"` when brand_style is missing).

The brand-asset save tool is `save_brand_asset`; the image generator is `generate_image`.
