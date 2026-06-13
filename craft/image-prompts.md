# Image generation prompts (per-purpose scaffolds)

Prompt-craft for the five generated-image purposes. The agent commands
(`fm-app-icon`, `fm-design` IMAGERY, `fm-brand-assets`) read this file to
**construct** a prompt; Forma core passes that prompt through verbatim and
never rewrites it (SPEC-BEHAVIOR-001). So every quality decision — palette
lock, anti-slop discipline, composition — has to be encoded here, not in the
generator.

> Adapted from [taste-skill](https://github.com/Leonxlnx/taste-skill) (MIT)
> anti-slop word lists, locked-palette discipline, and brandkit structure,
> re-scoped to Forma's five `IMAGE_PURPOSES` and brand-token system.

The five purposes and their default aspect (matching core's
`PURPOSE_DEFAULT_ASPECT`):

| Purpose | Default aspect | One-line intent |
|---|---|---|
| `app-icon` | `1:1` | A single launcher mark, no text, works at 24px |
| `illustration` | `4:3` | In-page spot / empty-state / onboarding art |
| `hero` | `16:9` | Wide marketing scene with a text-safe area |
| `poster-bg` | `9:16` | Vertical share/social poster backdrop |
| `store-shot-bg` | `9:16` | App-store screenshot backdrop (device sits on top) |

## Shared rules — apply to every purpose

### Locked palette

All generated material for a product locks to that product's `brand_style`
tokens. Before prompting, read the brand's `DESIGN.md` / tokens and inject the
**actual** values into the prompt — the resolved hex (`#0B5FFF`) plus the role
(`primary accent`). Tell the model the palette explicitly:

> Palette: locked to these exact colors only — `#0B5FFF` (primary),
> `#101418` (ink), `#F5F6F8` (surface). Do not introduce any other hue.

Never let the model invent off-brand colors. If the brand is monochrome, say
monochrome. The palette is a constraint, not a suggestion — repeat it at the
end of the prompt where models weight it more.

### Anti-slop bans (state these as negatives in the prompt)

These are the marks of default text-to-image output. Ban them explicitly:

- **No purple→blue or blue→cyan "AI" gradients** as a default background fill.
  A flat on-brand surface beats a two-stop trust gradient every time.
- **No floating 3D blobs, glass orbs, or gel/chrome spheres.**
- **No generic corporate-stock look** — no smiling-handshake / abstract-team /
  "innovation" stock clichés.
- **No lens flares, no heavy bokeh, no light-leak overlays.**
- **No meaningless swooshes, ribbons, or decorative geometric scatter.**
- **No drop-shadowed "floating card" UI** unless the purpose explicitly wants
  a UI mock.
- **No watermarks, signatures, logos, or fake brand marks** baked into the
  image.

### Veto checklist — the Read-inspection step (SPEC-BEHAVIOR-010)

After generation, the agent Reads each candidate and **vetoes** (regenerates,
does not ship) any image hitting these. These apply to all purposes:

1. **Garbled / gibberish text** — any rendered lettering that is misspelled,
   melted, or nonsense. (Most purposes want no text at all; see per-purpose.)
2. **Broken anatomy or impossible perspective** — extra/fused fingers, warped
   faces, melted objects, geometry that cannot exist.
3. **Style drift from brand** — off-palette colors, a rendering style that
   contradicts the brand's `DESIGN.md` (e.g. photoreal where the brand is
   flat-illustrative).
4. **Watermarks / signatures / stray UI chrome** the prompt did not ask for.
5. **Compression / generation artifacts** — banding, mushy edges, JPEG-style
   blocking, duplicated motifs.

A candidate that trips any veto item is rejected. Do not "ship the least-bad
one"; regenerate with a tightened prompt.

---

## How to read each purpose below

Each purpose gives **Intent / Composition / Include / Avoid** — compose these
into the generation prompt (Avoid items become explicit negatives) — plus a
**Per-purpose veto** that *extends* the shared Read-inspection checklist above
for that purpose. The veto items are inspection criteria, not prompt text.

---

## `app-icon` — default `1:1`

The launcher mark `fm-app-icon` stages a small set of MASTER images, not
per-size icons: Forma core derives the entire per-platform/surface variant set
locally (sharp) from those masters. Mobile/tablet → 3 masters (a/b/c);
web/desktop → 2 masters (a/b). All use `purpose="app-icon"`. This is the most
constrained purpose; get it right.

Shared app-icon rules (apply to every master): one memorable, brand-color-forward
symbol; single clear subject, centered; **no text or letterforms**, no
mockup/device frame, no app-store-listing chrome, no multiple competing subjects,
no fine detail that dissolves at small sizes, no realistic photography; must stay
legible scaled down to ~24px; the brand's primary accent doing the heavy lifting.

### `app-icon-logo` — master a (transparent logo)

- **Intent:** the brand mark itself, ready to composite over any base tile.
- **Composition:** single centered subject on a fully TRANSPARENT background
  (PNG with alpha), generous even padding so platform mask/rounding never clips
  it.
- **Include:** flat, or at most a single soft depth cue (no gloss, gel, chrome).
- **Avoid:** any background fill or surface, any text, any device frame.
- **Per-purpose veto (extra):** reject if the background is not transparent, it
  contains any text, or it has more than one focal subject.

### `app-icon-bg` — master b (opaque background)

- **Intent:** the base tile color/texture the logo sits on — the opaque icon
  background, no logo on it.
- **Composition:** an OPAQUE branded fill spanning the whole square, NO alpha;
  flat brand color or a restrained on-brand texture/gradient cue.
- **Include:** the brand's surface/primary tones; just enough interest to not
  read as a flat swatch.
- **Avoid:** any transparency/alpha, any logo or subject, any text, any device
  frame.
- **Per-purpose veto (extra):** reject if it carries alpha, shows the logo or a
  focal subject, or contains any text.

### `app-icon-safe` — master c (666² safe-area logo, mobile/tablet only)

- **Intent:** the adaptive-icon foreground — the logo placed so platform masking
  never clips it.
- **Composition:** the logo centered inside the 666×666 adaptive safe area on a
  1080×1080 TRANSPARENT canvas; nothing of the mark extends outside the 666²
  safe area.
- **Include:** the same mark as master a, scaled to live entirely within the
  safe area.
- **Avoid:** any content outside the 666² safe area, any opaque background, any
  text, any device frame.
- **Per-purpose veto (extra):** reject if the logo bleeds outside the 666² safe
  area, the canvas is not transparent, or it contains any text.

## `banner` — plan-driven target

Marketing banner / feature-graphic composition (e.g. Play feature graphic, app-store
promo banner). Rendered HTML→PNG at the plan entry's exact `{width,height}`; this
scaffold drives any optional generated background material.

- **Intent:** a wide, calm, on-brand backdrop that frames a short marketing line
  + the product mark.
- **Composition:** strong horizontal rhythm with a clear text-safe region (one
  side or a band) for an overlaid headline; focal interest off-center, opposite
  the copy.
- **Include:** restrained on-brand color blocking; room for the brand app-icon
  and a short headline.
- **Avoid:** no baked-in marketing copy, no edge-to-edge busyness that buries the
  headline, no off-brand accents, no device frame (that is composited in the HTML).
- **Per-purpose veto (extra):** reject if there is no usable text-safe region, if
  contrast under the intended copy is too low/noisy for legible overlaid type, or
  if it bakes in headline text.

## `poster` — plan-driven target (portrait / landscape / square)

Standalone marketing poster, rendered HTML→PNG at the plan entry's exact
`{width,height}`. The plan emits one entry per enabled orientation; the entry's
`variant` is the orientation. This scaffold drives any optional generated
background/illustration material.

- **Intent:** a confident, on-brand poster composition with a clear focal point.
- **Composition (per orientation):**
  - **portrait (1080×1920):** vertical rhythm top→bottom; text-safe bands at top
    and/or bottom for an overlaid title + footer.
  - **landscape (1920×1080):** horizontal layout; text-safe region to one side,
    focal interest opposite.
  - **square (1080×1080):** balanced centered composition with a calm corner/edge
    region reserved for an overlaid title.
- **Include:** bold on-brand color blocking; the brand app-icon where the layout
  calls for the product mark.
- **Avoid:** no baked-in poster/title text, no edge-to-edge busyness that leaves
  nowhere for the title, no off-brand accent colors.
- **Per-purpose veto (extra):** reject if the text-safe regions are unusable (too
  noisy/low-contrast for overlaid type), if it bakes in title text, or if the
  composition does not suit the orientation.

## `illustration` — default `4:3`

In-page art: spot illustration, empty-state, onboarding panel.

- **Intent:** a friendly, cohesive illustration that supports page content.
- **Composition:** one clear scene or motif; readable at content size (it sits
  inside a card or column, not full-bleed).
- **Include:** brand palette, a consistent illustration style (line weight,
  fill style) that matches the brand's `DESIGN.md`.
- **Avoid:** no baked-in text or labels (the page supplies copy), no
  photographic realism if the brand is illustrative, no clutter that won't
  survive downscaling.
- **Per-purpose veto (extra):** reject if it bakes in text, looks like generic
  flat-vector stock, or its style clashes with sibling illustrations on the
  same product.

## `hero` — default `16:9`

Wide marketing hero background / scene.

- **Intent:** an atmospheric on-brand backdrop for a landing hero.
- **Composition:** **keep a clear text-safe area** (a calm region — typically
  one side or the lower third) where an overlaid headline + CTA will sit. The
  focal interest lives off-center, opposite the text-safe zone.
- **Include:** on-brand color and mood; depth/atmosphere is fine if it stays
  subtle.
- **Avoid:** no busy detail across the whole frame (headline must stay
  legible), no baked-in headline text, no centered subject that fights the
  copy.
- **Per-purpose veto (extra):** reject if there is no usable text-safe area, if
  contrast under the intended text region is too low/noisy for legible
  overlaid type, or if it bakes in marketing copy.

## `poster-bg` — default `9:16`

Vertical poster background for social / share cards.

- **Intent:** a strong vertical backdrop with a confident focal composition.
- **Composition:** clear focal point with **text-safe zones** (top and/or
  bottom band) reserved for an overlaid title and footer.
- **Include:** bold on-brand color blocking; vertical rhythm that guides the
  eye top-to-bottom.
- **Avoid:** no baked-in poster text, no edge-to-edge busyness that leaves
  nowhere for the title, no off-brand accent colors.
- **Per-purpose veto (extra):** reject if the text-safe bands are unusable
  (too noisy/low-contrast for overlaid type) or if it bakes in title text.

## `store-shot-bg` — default `9:16`

Vertical app-store screenshot background. This is a **backdrop**, not a scene:
a device frame + a real product screenshot + selling copy get composited on
top.

- **Intent:** a clean, calm, on-brand surface that makes the device + copy pop.
- **Composition:** mostly negative space; a gentle gradient/texture or simple
  shape language, with clear room for a centered device mock and a short
  headline above or below it.
- **Include:** restrained on-brand color; just enough visual interest to not
  read as a blank fill.
- **Avoid:** **no busy illustration or scene**, no device frame (that is
  composited later), no baked-in screenshot or UI, no text, nothing that
  competes with the foreground device.
- **Per-purpose veto (extra):** reject if it is too busy to sit behind a device
  mock, if it already contains a phone/screenshot, or if it contains any text.
